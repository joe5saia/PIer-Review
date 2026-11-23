import { useState, useEffect } from "react";
import type { SubmitEvent } from "react";
import { z } from "zod";
import { report } from "../src/spec.ts";

const thread = z.object({
  id: z.string(),
  title: z.string(),
  role: z.string(),
  parent: z.string().nullable(),
  status: z.string(),
  busy: z.boolean(),
  waiting: z.boolean(),
  blockedBy: z.string().optional(),
  goal: z.string().optional(),
  reports: z.array(report),
});
export const index = z.object({
  mode: z.string(),
  sample: z.string(),
  projects: z.array(
    z.object({
      id: z.string(),
      threads: z.array(thread),
      pages: z.array(z.object({ path: z.string(), author: z.string(), at: z.string() })),
    }),
  ),
});
export type Project = z.infer<typeof index>["projects"][number];
export type Thread = Project["threads"][number];
export const messages = z.array(
  z.object({
    role: z.string(),
    text: z.string(),
    at: z.number().optional(),
    object: z.string().optional(),
    from: z.string().optional(),
    tool: z.string().optional(),
    step: z.string().optional(),
    failed: z.boolean().optional(),
    report: report.optional(),
  }),
);
export type Message = z.infer<typeof messages>[number];
export function spaceStatus(p: Project) {
  if (p.threads.some((t) => t.waiting)) {
    return "Needs input";
  }
  return p.threads.some((t) => t.busy) ? "Working" : "Idle";
}
export function href(project: string, view: string, id = "") {
  const params = new URLSearchParams({ project, view });
  if (id) {
    params.set("id", id);
  }
  return `#${params}`;
}
export function threadName(p: Project, t: Thread) {
  const peers = p.threads.filter((x) => x.role === t.role);
  const role = t.role[0]?.toUpperCase() + t.role.slice(1);
  return peers.length > 1 ? `${role} ${peers.indexOf(t) + 1}` : role;
}
export function errorText(e: unknown) {
  if (e instanceof TypeError) {
    return "Server unreachable.";
  }
  return e instanceof Error ? e.message : "Request failed.";
}
export function submit(handle: (form: HTMLFormElement) => Promise<void>) {
  return (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handle(e.currentTarget);
  };
}
export async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
  const r = await fetch(
    path,
    body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {},
  );
  if (!r.ok) {
    const value = z.object({ error: z.string() }).safeParse(await r.json().catch(() => null));
    throw new Error(value.success ? value.data.error : r.statusText);
  }
  return schema.parse(await r.json());
}
export function useFeed<T>(path: string, schema: z.ZodType<T>, repeat = true) {
  // Keyed by path, so a new path never shows the previous path's data.
  const [state, set] = useState<{ path: string; value: T }>(),
    [error, fail] = useState("");
  useEffect(() => {
    // An empty path waits for one, for example until a space is selected.
    if (!path) {
      return;
    }
    let open = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      let retry = repeat;
      try {
        const value = await request(path, schema);
        if (open) {
          set({ path, value });
          fail("");
        }
      } catch (error_) {
        retry = true;
        if (open) {
          fail(error_ instanceof TypeError ? "Server unreachable. Retrying…" : errorText(error_));
        }
      } finally {
        if (open && retry) {
          timer = setTimeout(load, 800);
        }
      }
    }
    void load();
    return () => {
      open = false;
      clearTimeout(timer);
    };
  }, [path, schema, repeat]);
  return { data: state?.path === path ? state.value : undefined, error };
}
