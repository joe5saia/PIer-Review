import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { it, expect } from "vitest";
import { z } from "zod";

async function serve(dir: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn("./pier", ["serve"], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PIER_DATA: dir, PORT: "0", PIER_MODE: "fixture", ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) {
      lines.close();
      return {
        url,
        stop: async (signal: NodeJS.Signals = "SIGTERM") => {
          child.kill(signal);
          await exited;
        },
      };
    }
  }
  throw new Error("Pier exited before printing its address");
}
const projectIndex = z.object({
  projects: z.array(
    z.object({
      threads: z.array(
        z.object({
          id: z.string(),
          role: z.string(),
          waiting: z.boolean(),
          reports: z.array(z.object({ result: z.string(), where: z.string() })),
        }),
      ),
    }),
  ),
});
const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
it("resumes admitted research after a process kill and delivers the Reader evidence to a project note", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pier-e2e-"));
  let server = await serve(dir);
  try {
    let base = `${server.url}/api/projects`;
    expect((await fetch(server.url)).status).toBe(200);
    const bad = await fetch(base, { method: "POST", headers: { origin: "https://other.invalid" } });
    expect(bad.status).toBe(403);
    const created = await post(base, { id: "wetlands", source: "Transect A: 4\nTransect B: 11\nTransect C: 2" });
    expect(created.ok, await created.clone().text()).toBe(true);
    const { id } = z.object({ id: z.uuid() }).parse(await created.json());
    const route = `/wetlands/threads/${id}`;
    expect((await post(base + route, { text: "Total the visits and save the evidence." })).ok).toBe(true);
    await server.stop("SIGKILL");
    server = await serve(dir);
    base = `${server.url}/api/projects`;
    const threads = async () => projectIndex.parse(await (await fetch(base)).json()).projects[0]?.threads ?? [];
    await expect
      .poll(async () => (await threads())[0]?.reports.at(-1)?.result, { timeout: 35_000 })
      .toBe("17 visits recorded across 3 survey sites.");
    const all = await threads();
    expect(all.map((t) => t.role)).toEqual(["coordinator", "researcher", "reader"]);
    const reader = all.find((t) => t.role === "reader");
    if (!reader) {
      throw new Error("Missing Reader");
    }
    const history = z.array(z.object({ role: z.string(), text: z.string() }));
    const readerUrl = `${base}/wetlands/threads/${reader.id}`;
    const log = history.parse(await (await fetch(readerUrl)).json());
    expect(log.find((m) => m.role === "toolResult" && m.text.includes("Script completed"))?.text).toContain(
      '"fetch":"undefined","process":"undefined","denied":true',
    );
    expect(history.parse(await (await fetch(base + route)).json()).some((m) => m.role === "Child report")).toBe(true);
    const files = z.array(z.string()).parse(await (await fetch(`${base}/wetlands/notes`)).json());
    expect(files).toHaveLength(2);
    const summary = all[0]?.reports[0]?.where;
    expect(files).toContain(summary);
    expect(files).toContain(reader.reports[0]?.where);
    expect(await (await fetch(`${base}/wetlands/notes?path=${summary}`)).json()).toContain("17 visits");
    for (const t of all) {
      const { stdout } = await promisify(execFile)("docker", [
        "inspect",
        "--format",
        "{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}} {{.Config.User}}",
        `pier-${t.id}`,
      ]);
      expect(stdout.trim()).toBe("none true 65534:65534");
    }
    expect((await post(readerUrl, { text: "Which site had the most visits?" })).ok).toBe(true);
    await expect.poll(async () => (await threads()).at(-1)?.reports.length, { timeout: 10_000 }).toBe(2);
    expect((await threads()).at(-1)?.reports.at(-1)?.result).toBe("Transect B had the most visits: 11.");
    expect(await (await fetch(`${base}/wetlands/notes`)).json()).toEqual(files);
    await expect
      .poll(async () =>
        history
          .parse(await (await fetch(base + route)).json())
          .some((m) => m.role === "Child report" && m.text === "Transect B had the most visits: 11."),
      )
      .toBe(true);
    expect((await post(base + route, { text: "Total the visits again." })).ok).toBe(true);
    await expect.poll(async () => (await threads())[0]?.reports.length, { timeout: 20_000 }).toBe(2);
    expect((await threads())[0]?.reports.at(-1)).toMatchObject({
      result: "17 visits recorded across 3 survey sites.",
      where: summary,
    });
    expect(await (await fetch(`${base}/wetlands/notes`)).json()).toEqual(files);
    expect((await fetch(`${base}/wetlands/notes?path=../outside.md`)).ok).toBe(false);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it("answers a delegated wait after restart without spawning replacement threads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pier-wait-"));
  let server = await serve(dir);
  try {
    const base = () => `${server.url}/api/projects`;
    const threads = async () => projectIndex.parse(await (await fetch(base())).json()).projects[0]?.threads ?? [];
    const { id } = z
      .object({ id: z.uuid() })
      .parse(await (await post(base(), { id: "docks", source: "No observations yet." })).json());
    const send = (text: string) => post(`${base()}/docks/threads/${id}`, { text });
    expect((await send("Count the visits.")).ok).toBe(true);
    await expect
      .poll(async () => (await threads())[0]?.reports.at(-1)?.result, { timeout: 20_000 })
      .toBe("No survey counts found.");
    const before = await threads();
    expect(before.filter((t) => t.waiting).map((t) => t.role)).toEqual(["reader"]);
    await server.stop();
    server = await serve(dir);
    expect((await send("East dock: 5 / West dock: 0")).ok).toBe(true);
    await expect
      .poll(async () => (await threads())[0]?.reports.at(-1)?.result, { timeout: 20_000 })
      .toBe("5 visits recorded across 2 survey sites.");
    await server.stop();
    server = await serve(dir);
    const after = await threads();
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
    expect(after.some((t) => t.waiting)).toBe(false);
    expect(after.every((t) => t.reports.at(-1)?.result === "5 visits recorded across 2 survey sites.")).toBe(true);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it("publishes a create-only Pecia page and a waiting report through live-mode clients on loopback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pier-live-e2e-"));
  let page = "",
    turn = 0,
    comments = false,
    workspace = "";
  const remote = createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/responses" && req.headers.authorization === "Bearer test-model") {
        const calls = [
          {
            name: "codemode",
            args: {
              code: `const source=await tools.read_source({});text(await tools.write_note({path:'evidence.md',content:source}));`,
            },
          },
          { name: "mcp__pecia__list_threads", args: { path: "evidence.md" } },
          {
            name: "report",
            args: {
              result: "Source preserved.",
              notDone: "Second observation pending.",
              where: "evidence.md",
              next: "Supply the second observation.",
              waitingOn: "Second survey",
            },
          },
        ];
        const call = calls[turn++];
        if (!call) {
          res.writeHead(400).end("{}");
          return;
        }
        const item = {
          type: "function_call",
          id: `fc_${turn}`,
          call_id: `call_${turn}`,
          name: call.name,
          arguments: JSON.stringify(call.args),
        };
        res.setHeader("Content-Type", "text/event-stream");
        for (const event of [
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: `resp_${turn}`, status: "completed", output: [item] } },
        ]) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
        return;
      }
      if (req.url === "/mcp" && req.headers.authorization === "Bearer test-mcp") {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        const rpc = z
          .object({ id: z.number().optional(), method: z.string(), params: z.unknown().optional() })
          .parse(JSON.parse(body));
        if (rpc.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        if (rpc.method === "tools/call") {
          comments = z
            .object({
              name: z.literal("list_threads"),
              arguments: z.object({ workspace: z.literal("wetlands"), path: z.literal("evidence.md") }),
            })
            .safeParse(rpc.params).success;
        }
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result:
              rpc.method === "initialize"
                ? {
                    protocolVersion: "2025-11-25",
                    serverInfo: { name: "fixture", version: "1" },
                    capabilities: { tools: {} },
                  }
                : { content: [{ type: "text", text: "No open comments" }] },
          }),
        );
        return;
      }
      if (req.headers.authorization !== "Bearer test-pecia") {
        res.writeHead(401).end("{}");
        return;
      }
      if (req.url === "/workspaces" && req.method === "GET") {
        res.end(JSON.stringify([{ name: "existing" }]));
        return;
      }
      if (req.url === "/workspaces" && req.method === "POST") {
        workspace = z.object({ name: z.string() }).parse(JSON.parse(body)).name;
        res.end(JSON.stringify({ workspace }));
        return;
      }
      if (req.url === `/workspaces/${workspace}/edits`) {
        const edit = z
          .object({
            changes: z.tuple([
              z.object({
                _tag: z.literal("Write"),
                expected: z.null(),
                path: z.literal("evidence.md"),
                content: z.string(),
              }),
            ]),
          })
          .safeParse(JSON.parse(body));
        if (!edit.success) {
          res.writeHead(400).end("{}");
          return;
        }
        page = edit.data.changes[0].content;
        res.end('{"status":"published"}');
        return;
      }
      if (req.url === `/workspaces/${workspace}/tree`) {
        res.end(JSON.stringify({ files: [{ path: "evidence.md" }] }));
        return;
      }
      if (req.url === `/workspaces/${workspace}/file?path=evidence.md`) {
        res.end(page);
        return;
      }
      res.writeHead(404).end("{}");
    });
  });
  remote.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const a = remote.address();
  if (!a || typeof a === "string") {
    throw new Error("No test port");
  }
  const origin = `http://127.0.0.1:${a.port}`;
  const server = await serve(dir, {
    PIER_MODE: "live",
    PECIA_URL: origin,
    OPENAI_API_KEY: "test-model",
    PECIA_ORCHESTRATOR_KEY: "test-pecia",
    PECIA_MCP_TOKEN: "test-mcp",
    NODE_OPTIONS: "--import=./e2e/support/loopback.ts",
  });
  try {
    const base = `${server.url}/api/projects`;
    expect((await post(base, { id: "existing", source: "A: 18" })).ok).toBe(false);
    expect(workspace).toBe("");
    const created = await post(base, { id: "wetlands", source: "A: 18" });
    const { id } = z.object({ id: z.uuid() }).parse(await created.json());
    const threadUrl = `${base}/wetlands/threads/${id}`;
    expect((await post(threadUrl, { text: "Preserve the survey source and check for reviewer comments." })).ok).toBe(
      true,
    );
    await expect.poll(async () => await (await fetch(base)).text(), { timeout: 20_000 }).toContain("Second survey");
    expect(comments).toBe(true);
    expect(page).toBe("A: 18");
    expect(await (await fetch(`${base}/wetlands/notes`)).json()).toEqual(["evidence.md"]);
    expect(await (await fetch(`${base}/wetlands/notes?path=evidence.md`)).json()).toBe("A: 18");
  } finally {
    await server.stop();
    remote.close();
    await rm(dir, { recursive: true, force: true });
  }
});
