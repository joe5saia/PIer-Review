import { useState } from "react";
import { z } from "zod";
import { href, messages, request, useFeed, errorText, threadName, submit } from "./data.ts";
import type { Thread, Project } from "./data.ts";
import { page } from "../src/spec.ts";

const steps = new Map(
  Object.entries({
    codemode: "Analyzed the source in the sandbox",
    spawn_subagent: "Delegated a research task",
    spawn_thread: "Opened a research thread",
    send_message: "Sent a thread message",
    wait_for_threads: "Checked delegated work",
    stop_subagent: "Stopped delegated work",
    write_note: "Saved a notebook page",
    read_note: "Read a notebook page",
    list_notes: "Checked project notes",
    read_source: "Read the project source",
    list_threads: "Checked project threads",
    read_thread: "Read a thread",
    mcp__pecia__list_threads: "Checked page comments",
    set_status: "Updated thread status",
    report: "Filed a report",
  }),
);
function Report({ p, r }: { p: Project; r: Thread["reports"][number] }) {
  return (
    <article>
      <div className="eyebrow">Field report</div>
      <h3>{r.result}</h3>
      <dl>
        <div>
          <dt>Not done</dt>
          <dd>{r.notDone}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {page.safeParse(r.where).success ? <a href={href(p.id, "notes", r.where)}>Open cited note</a> : r.where}
          </dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>{r.next}</dd>
        </div>
      </dl>
    </article>
  );
}
export function Conversation({ t, p, offline }: { t: Thread; p: Project; offline: boolean }) {
  const path = `/api/projects/${p.id}/threads/${t.id}`;
  const { data, error } = useFeed(path, messages);
  const [sending, setSending] = useState(false),
    [issue, setIssue] = useState("");
  let owner = t;
  while (owner.blockedBy) {
    const child = p.threads.find((c) => c.id === owner.blockedBy && c.parent === owner.id);
    if (!child) {
      break;
    }
    owner = child;
  }
  const latest = t.reports.at(-1),
    parent = p.threads.find((c) => c.id === t.parent),
    blocked = offline || owner.busy || sending;
  const title = threadName(p, t);
  return (
    <>
      <div className="eyebrow">
        {title}{" "}
        {parent && (
          <>
            {" "}
            / Assigned by <a href={href(p.id, "thread", parent.id)}>{threadName(p, parent)}</a>
          </>
        )}
      </div>
      <h2>{t.title}</h2>
      <span className="badge">{t.status}</span>
      {owner.id !== t.id && (
        <p>
          This question belongs to <a href={href(p.id, "thread", owner.id)}>{threadName(p, owner)}</a>. A reply here
          goes directly there.
        </p>
      )}
      {latest && <Report p={p} r={latest} />}{" "}
      {t.reports.length > 1 && (
        <details>
          <summary>Earlier reports ({t.reports.length - 1})</summary>
          {t.reports
            .slice(0, -1)
            .toReversed()
            .map((r, i) => (
              <Report key={i} p={p} r={r} />
            ))}
        </details>
      )}
      <form
        onSubmit={submit(async (form) => {
          if (blocked) {
            return;
          }
          setSending(true);
          setIssue("");
          try {
            await request(path, z.object({}), Object.fromEntries(new FormData(form)));
            form.reset();
          } catch (error_) {
            setIssue(errorText(error_));
          } finally {
            setSending(false);
          }
        })}
      >
        <label>
          {owner.waiting
            ? `Answer ${threadName(p, owner)}: ${owner.reports.at(-1)?.waitingOn ?? "Input requested"}`
            : "Message this thread"}
          <textarea
            name="text"
            required
            rows={2}
            maxLength={32_000}
            placeholder="Write a message…"
            disabled={blocked}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        {issue && <p role="alert">{issue}</p>}
        <button type="submit" disabled={blocked}>
          {owner.busy ? "Thread is working…" : "Send message"}
        </button>
        <small className="keyhint">Enter to send · Shift+Enter for a new line</small>
      </form>
      <h4>Conversation</h4>
      {parent && <p className="quiet">Reports are shared up to the coordinator without starting another turn.</p>}
      {error && !offline && <p>{error}</p>}
      {!data?.length && <p>No messages yet.</p>}
      {data?.map((m, i) => {
        const from = p.threads.find((x) => x.id === m.from);
        if (m.role === "toolResult") {
          return m.failed ? (
            <p key={i} role="alert">
              {steps.get(m.tool ?? "") ?? "Research step"} — failed. {m.text}
            </p>
          ) : null;
        }
        if (m.step) {
          return (
            <p className="step" key={i}>
              ↳ {steps.get(m.step) ?? "Used a research tool"}
            </p>
          );
        }
        const delegated = from ?? (m.role === "user" && parent && i === 0 ? parent : undefined);
        let label = title;
        if (m.role === "user") {
          label = delegated ? `Task from ${threadName(p, delegated)}` : "You";
        }
        if (m.role === "Child report") {
          label = from ? `Report from ${threadName(p, from)}` : "Delegated report";
        }
        if (m.role === "Forwarded reply" && from) {
          label = `You · reply forwarded to ${threadName(p, from)}`;
        }
        return (
          <div className="message" key={i}>
            <strong>{delegated ? <a href={href(p.id, "thread", delegated.id)}>{label}</a> : label}</strong>
            <p>{m.text}</p>
          </div>
        );
      })}
    </>
  );
}
