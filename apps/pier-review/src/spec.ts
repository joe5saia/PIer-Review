import { z } from "zod";

export const name = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(50);
export const page = z
  .string()
  .regex(/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md$/i)
  .max(160);
export const note = z.string().trim().min(1).max(32_000);
export const report = z.object({ result: note, notDone: note, where: note, next: note, waitingOn: note.optional() });
export const agent = z.strictObject({
  name,
  description: note,
  model: z.strictObject({ provider: z.literal("openai"), id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,99}$/) }),
  instructions: z.array(note),
  tools: z.array(z.enum(["read_source", "list_comments"])),
  capabilities: z.strictObject({
    spawn: z.array(name),
    pecia: z.enum(["read", "write"]).optional(),
    threads: z.strictObject({ read: z.boolean().optional(), message: z.boolean().optional() }).optional(),
  }),
  limits: z
    .strictObject({ maxTurns: z.number().int().min(1).max(32), maxNestedCalls: z.number().int().min(1).max(48) })
    .optional(),
  codemode: z.union([
    z.strictObject({ enabled: z.literal(false) }),
    z.strictObject({
      enabled: z.literal(true),
      models: z.literal(false),
      timeoutMs: z.number().int().min(100).max(10_000),
      memoryLimitBytes: z
        .number()
        .int()
        .min(1 << 20)
        .max(64 << 20),
    }),
  ]),
});
export const project = z.strictObject({ coordinator: name, agents: z.array(agent).min(1) }).superRefine((p, ctx) => {
  const names = new Set(p.agents.map((a) => a.name));
  if (
    names.size !== p.agents.length ||
    !names.has(p.coordinator) ||
    p.agents.some((a) => a.capabilities.spawn.some((s) => !names.has(s)))
  ) {
    ctx.addIssue({ code: "custom", message: "Agent names must be unique and all references must resolve" });
  }
});
export type Agent = z.infer<typeof agent>;
export const defineAgent = (a: Agent) => agent.parse(a);
export const defineProject = (p: z.infer<typeof project>) => project.parse(p);
