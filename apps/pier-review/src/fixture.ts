import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { z } from "zod";
import { report } from "./spec.ts";

export const sample = "Harbor bird survey · visits per transect\nNorth Pier: 7\nSalt Marsh: 12\nSouth Jetty: 4";
const call = (tool: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(tool, args), { stopReason: "toolUse" });
export function fixtureModel(role: string, child: string | undefined, id: string) {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  const respond: FauxResponseFactory = (ctx) => {
    faux.appendResponses([respond]);
    const recent = ctx.messages.slice(ctx.messages.findLastIndex((m) => m.role === "user") + 1);
    const results = recent.filter((m) => m.role === "toolResult");
    const last = results.at(-1);
    const body = last?.content.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
    const path = `findings-${id.slice(0, 8)}-${ctx.messages.length}.md`;
    if (last?.isError) {
      return call("report", {
        result: `Tool failed: ${body.slice(0, 800)}`,
        notDone: "Research incomplete",
        where: "Transcript",
        next: "Check the tool error",
        waitingOn: "Review the failure",
      });
    }
    if (!last && child) {
      return call("spawn_subagent", {
        agent: child,
        task: "Analyze the supplied survey. Report the number of sites and total visits.",
      });
    }
    if (!last) {
      return call("codemode", {
        code: `const source=await tools.read_source({}); const counts=[...source.matchAll(/:\\s*(\\d+)\\s*$/gm)].map(m=>Number(m[1])); let denied=false; try{await tools.list_threads({});}catch{denied=true;} const where=await tools.write_note({path:${JSON.stringify(path)},content:'Survey counts: '+counts.join(', ')}); text({sites:counts.length,visits:counts.reduce((a,b)=>a+b,0),fetch:typeof fetch,process:typeof process,denied,where});`,
      });
    }
    const delegated = results
      .find((m) => m.toolName === "spawn_subagent")
      ?.content.find((c) => c.type === "text")?.text;
    const childReport = delegated ? z.object({ report }).parse(JSON.parse(delegated)).report : undefined;
    if (childReport?.waitingOn) {
      return call("report", { ...childReport, waitingOn: childReport.waitingOn });
    }
    if (role === "researcher" && childReport && last.toolName === "spawn_subagent") {
      return call("write_note", {
        path,
        content: `# Survey evidence\n\n${childReport.result}\n\nSource: supplied transect counts.`,
      });
    }
    if (last.toolName === "report") {
      return fauxAssistantMessage("The structured report is ready.");
    }
    let evidence = childReport?.result;
    let where = childReport?.where;
    if (!evidence) {
      const counts = z
        .object({ sites: z.number(), visits: z.number(), where: z.string() })
        .parse(JSON.parse(body.slice(body.lastIndexOf("{"))));
      if (!counts.sites) {
        return call("report", {
          result: "No survey counts found.",
          notDone: "The total is unknown.",
          where: counts.where,
          next: "Create a project with one Site: count row per observation.",
          waitingOn: "Numeric survey rows",
        });
      }
      evidence = `${counts.visits} visits recorded across ${counts.sites} survey sites.`;
      where = counts.where;
    }
    return call("report", {
      result: evidence.slice(0, 2000),
      notDone: "No independent field observations.",
      where: last.toolName === "write_note" ? body : (where ?? "Source and tool transcript"),
      next: "Compare another survey.",
    });
  };
  faux.setResponses([respond]);
  return faux;
}
