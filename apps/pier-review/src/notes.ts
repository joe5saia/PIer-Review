import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpClient, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { name, page, note } from "./spec.ts";

async function request(path: string, body?: unknown) {
  const url = new URL(path, process.env.PECIA_URL);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1") {
    throw new Error("Pecia needs HTTPS");
  }
  const key = process.env.PECIA_ORCHESTRATOR_KEY;
  if (!key) {
    throw new Error("PECIA_ORCHESTRATOR_KEY missing");
  }
  const headers = new Headers({ Authorization: `Bearer ${key}` });
  for (const [env, header] of [
    ["CF_ACCESS_CLIENT_ID", "CF-Access-Client-Id"],
    ["CF_ACCESS_CLIENT_SECRET", "CF-Access-Client-Secret"],
  ] as const) {
    if (process.env[env]) {
      headers.set(header, process.env[env]);
    }
  }
  if (body) {
    headers.set("Content-Type", "application/json");
  }
  const init: RequestInit = {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  };
  if (body) {
    init.method = "POST";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  if (!r.ok) {
    throw new Error(`Pecia ${path.split("?")[0]}: HTTP ${r.status}`);
  }
  return r;
}
// The agent supplies only a page name. The host fixes the origin, workspace and operation.
export function workspace(dir: string, workspaceName: string, live: boolean) {
  const slug = name.parse(workspaceName),
    local = join(dir, "notes", slug),
    prefix = `/workspaces/${slug}`;
  return {
    async comments(path: string) {
      page.parse(path);
      if (!live) {
        return "[]";
      }
      const url = new URL("/mcp", process.env.PECIA_URL);
      const key = process.env.PECIA_MCP_TOKEN;
      if ((url.protocol !== "https:" && url.hostname !== "127.0.0.1") || !key) {
        throw new Error("Pecia MCP needs HTTPS and a read-scoped PECIA_MCP_TOKEN");
      }
      const client = new McpClient({ name: "pier-review", version: "1" });
      try {
        await client.connect(
          new StreamableHttpTransport({ url, headers: { Authorization: `Bearer ${key}` }, openGetStream: false }),
        );
        const result = await client.callTool("list_threads", { workspace: slug, path, state: "open" });
        if (result.isError) {
          throw new Error("Pecia refused the comment lookup");
        }
        return JSON.stringify(result.structuredContent ?? result.content).slice(0, 32_000);
      } finally {
        await client.close();
      }
    },
    async create() {
      if (live) {
        const index = await request("/workspaces");
        const existing = z.array(z.object({ name: z.string() })).parse(await index.json());
        if (existing.some((w) => w.name === slug)) {
          throw new Error("That Pecia workspace already exists. Choose a fresh project name.");
        }
        const r = await request("/workspaces", { name: slug });
        z.object({ workspace: z.literal(slug) }).parse(await r.json());
      } else {
        await mkdir(local, { recursive: true });
      }
    },
    async list() {
      if (live) {
        const r = await request(`${prefix}/tree`);
        return z
          .object({ files: z.array(z.object({ path: z.string() })) })
          .parse(await r.json())
          .files.map((f) => f.path)
          .filter((p) => page.safeParse(p).success);
      }
      return (await readdir(local, { recursive: true })).filter((p) => page.safeParse(p).success);
    },
    async read(path: string) {
      page.parse(path);
      if (live) {
        return (await (await request(`${prefix}/file?path=${encodeURIComponent(path)}`)).text()).slice(0, 32_000);
      }
      return (await readFile(join(local, path), "utf8")).slice(0, 32_000);
    },
    async write(path: string, content: string) {
      page.parse(path);
      note.parse(content);
      if (live) {
        const r = await request(`${prefix}/edits`, {
          idempotencyKey: randomUUID(),
          message: `Add ${path}`,
          changes: [{ _tag: "Write", path, expected: null, content }],
        });
        z.object({ status: z.enum(["published", "unchanged"]) }).parse(await r.json());
      } else {
        await mkdir(dirname(join(local, path)), { recursive: true });
        await writeFile(join(local, path), content, { flag: "wx" });
      }
      return path;
    },
  };
}
