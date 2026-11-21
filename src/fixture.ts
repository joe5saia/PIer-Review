import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { z } from "zod";
import { report } from "./spec.ts";

export const sample = "Harbor bird survey · visits per transect\nNorth Pier: 7\nSalt Marsh: 12\nSouth Jetty: 4";
const observations = z.object({ rows: z.array(z.tuple([z.string(), z.number()])), where: z.string() });
function readObservations(body: string) {
  const value = body.split("\nOutput:\n")[1];
  if (!value) {
    return undefined;
  }
  try {
    return observations.safeParse(JSON.parse(value)).data;
  } catch {
    return undefined;
  }
}
const call = (tool: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(tool, args), { stopReason: "toolUse" });
export function fixtureModel(role: string, child: string | undefined, id: string) {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  const respond: FauxResponseFactory = (ctx) => {
    faux.appendResponses([respond]);
    const inputs = ctx.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"),
      );
    const question = inputs.at(-1) ?? "";
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
        title: role === "coordinator" ? "Survey synthesis" : "Site observations",
        task: question,
      });
    }
    if (!last) {
      const supplied = inputs.findLast((s) => /[^:\n]+:\s*\d+(?:\s*(?:\/|\n|$))/.test(s)) ?? "";
      return call("codemode", {
        code: `const source = await tools.read_source({});
const parse = s => s.split(/[\\n/]/).map(line => line.trim().match(/^([^:]+):\\s*(\\d+)$/)).filter(Boolean).map(m => [m[1].trim(), Number(m[2])]);
const sourceRows = parse(source);
const rows = sourceRows.length ? sourceRows : parse(${JSON.stringify(supplied)});
let denied = false;
try { await tools.list_threads({}); } catch { denied = true; }
let where = 'Project source';
if (rows.length) {
  where = await tools.write_note({ path: ${JSON.stringify(path)}, content: '# Site observations\\n\\n' + rows.map(([site,n]) => '- ' + site + ': ' + n).join('\\n') });
}
text({rows, fetch:typeof fetch, process:typeof process, denied, where});`,
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
      const counts = readObservations(body);
      if (!counts) {
        throw new Error("Missing survey calculation");
      }
      if (!counts.rows.length) {
        return call("report", {
          result: "No survey counts found.",
          notDone: "The total is unknown.",
          where: counts.where,
          next: "Reply with Site: count rows, one per line or separated by a slash.",
          waitingOn: "Numeric survey rows",
        });
      }
      const max = Math.max(...counts.rows.map(([, n]) => n));
      evidence = /\b(most|highest|maximum|busiest)\b/i.test(question)
        ? `${counts.rows
            .filter(([, n]) => n === max)
            .map(([site]) => site)
            .join(" and ")} had the most visits: ${max}.`
        : `${counts.rows.reduce((sum, [, n]) => sum + n, 0)} visits recorded across ${counts.rows.length} survey sites.`;
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
