import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { z } from "zod";
import { Desk } from "./research.ts";
import { sample } from "./fixture.ts";
import { project, note, name } from "./spec.ts";
import { workspace } from "./notes.ts";
import template from "../projects/default.ts";

if (process.argv[2] !== "serve") {
  throw new Error("Usage: pier serve");
}
const live = process.env.PIER_MODE === "live";
if (process.env.PIER_MODE && !["live", "fixture"].includes(process.env.PIER_MODE)) {
  throw new Error("PIER_MODE must be live or fixture");
}
if (live && (!process.env.PECIA_URL || !process.env.PECIA_ORCHESTRATOR_KEY || !process.env.OPENAI_API_KEY)) {
  throw new Error("Live mode requires PECIA_URL, PECIA_ORCHESTRATOR_KEY and OPENAI_API_KEY");
}
const mode = live ? "live" : "fixture";
const dir = join(process.env.PIER_DATA ?? join(homedir(), ".pier"), mode);
const spec = process.env.PIER_PROJECT
  ? z.object({ default: project }).parse(await import(pathToFileURL(resolve(process.env.PIER_PROJECT)).href)).default
  : template;
const desk = new Desk(dir, live, spec);
const port = z.coerce
  .number()
  .int()
  .min(0)
  .max(65_535)
  .parse(process.env.PORT ?? 4317);
const assets = fileURLToPath(new URL("../dist/", import.meta.url));
await access(join(assets, "index.html"));
async function body<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  if (req.headers["content-type"] !== "application/json") {
    throw new Error("Expected application/json");
  }
  let size = 0;
  const chunks: Array<Buffer> = [];
  for await (const c of req) {
    const chunk: Buffer = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    size += chunk.length;
    if (size > 160_000) {
      throw new Error("Body too large");
    }
    chunks.push(chunk);
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
const frame = `<!doctype html><meta charset="utf-8"><script>
addEventListener("message", (e) => {
  if (e.source !== parent || typeof e.data !== "string") return;
  document.open();
  document.write('<style>body{margin:8px;font:15px/1.55 Jost Variable,Futura,Avenir,sans-serif;color:#2b2622;background:#fbf6ea}</style>' + e.data +
    '<script>addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href^=\\'#thread=\\']"); if (a) { e.preventDefault(); parent.postMessage({ open: a.getAttribute("href").slice(8) }, "*"); } });' +
    'new ResizeObserver(() => parent.postMessage({ h: document.documentElement.scrollHeight }, "*")).observe(document.documentElement)<\\/script>');
  document.close();
}, { once: true });
</script>`;
let restoring = true;
async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    // Local-only, including the Host check to reject DNS rebinding.
    const host = req.headers.host ?? "";
    if (
      !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`),
      path = url.pathname;
    if (restoring && path.startsWith("/api/")) {
      res
        .writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" })
        .end(JSON.stringify({ error: "Reattaching research threads…" }));
      return;
    }
    const json = (v: unknown) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(v));
    };
    if (req.method === "GET" && path === "/api/projects") {
      json({
        mode,
        sample,
        projects: desk.projects.map((p) => ({
          id: p.id,
          threads: p.threads.map((t) => ({ ...t, busy: desk.running.has(t.id) || t.status === "Working" })),
          pages: p.pages,
        })),
      });
      return;
    }
    if (req.method === "POST" && path === "/api/projects") {
      // A space can start from its name alone: fixture mode gets the offline survey, live mode a placeholder the
      // person replaces on the Source document page.
      const args = await body(req, z.object({ id: name, source: note.optional() }));
      const source = args.source ?? (live ? "No source document yet. Add one on the Source document page." : sample);
      json({ id: await desk.create(args.id, source) });
      return;
    }
    const [, api, projects, id, section, key] = path.split("/");
    if (api === "api" && projects === "projects") {
      const p = desk.projects.find((it) => it.id === id);
      if (!p) {
        res.writeHead(404).end();
        return;
      }
      if (section === "source" && req.method === "POST") {
        const args = await body(req, z.object({ source: note }));
        p.source = args.source;
        desk.save();
        json({ saved: true });
        return;
      }
      if (section === "source" && req.method === "GET") {
        json(p.source);
        return;
      }
      if (section === "briefing" && req.method === "GET") {
        json(p.briefing);
        return;
      }
      if (section === "notes" && req.method === "GET") {
        const n = workspace(dir, p.id, live);
        const file = url.searchParams.get("path");
        json(file ? await n.read(file) : await n.list());
        return;
      }
      const t = p.threads.find((it) => it.id === key);
      if (section === "threads" && t) {
        if (req.method === "GET") {
          json(await desk.history(p, t));
          return;
        }
        if (req.method === "POST") {
          const args = await body(req, z.object({ text: note }));
          await desk.message(p, t, args.text);
          json({ accepted: true });
          return;
        }
      }
    }
    if (req.method === "GET" && path === "/frame") {
      // Renders agent-written HTML blocks: opaque origin, inline code only, no network or navigation.
      res.setHeader("Content-Type", "text/html");
      res.setHeader(
        "Content-Security-Policy",
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
      );
      res.end(frame);
      return;
    }
    if (req.method === "GET" && (path === "/" || /^\/assets\/[\w.-]+\.(js|css|woff2)$/.test(path))) {
      const contents = await readFile(join(assets, path === "/" ? "index.html" : path));
      const assetType = { css: "text/css", woff2: "font/woff2" }[path.split(".").at(-1) ?? ""] ?? "text/javascript";
      res.setHeader("Content-Type", path === "/" ? "text/html" : assetType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      res.end(contents);
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
  }
}
const server = createServer((req, res) => {
  void handle(req, res);
});
await new Promise<void>((ready) => {
  server.listen(port, "127.0.0.1", ready);
});
for (const p of desk.projects) {
  for (const t of p.threads) {
    await desk.open(p, t);
  }
}
restoring = false;
const a = server.address();
if (a && typeof a !== "string") {
  process.stdout.write(`Pier Review (${mode}): http://127.0.0.1:${a.port}\n`);
}
async function stop() {
  server.close();
  await desk.close();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
