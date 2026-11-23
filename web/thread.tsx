import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import { href, messages, request, useFeed, errorText, threadName, submit } from "./data.ts";
import type { Thread, Project, Message } from "./data.ts";
import { page } from "../src/spec.ts";
import { Rich } from "./markdown.tsx";

// A step's words: the verb in its row, and the summary's words for `n` of them ("saved 2 notes").
const words = new Map<string, [string, (n: number) => string]>(
  Object.entries({
    codemode: ["Ran analysis", (n) => (n === 1 ? "ran an analysis" : `ran ${n} analyses`)],
    spawn_subagent: ["Delegated", (n) => (n === 1 ? "delegated a task" : `delegated ${n} tasks`)],
    spawn_thread: ["Opened thread", (n) => (n === 1 ? "opened a thread" : `opened ${n} threads`)],
    send_message: ["Messaged", (n) => (n === 1 ? "sent a message" : `sent ${n} messages`)],
    wait_for_threads: ["Waited on", () => "waited on delegated work"],
    stop_subagent: ["Stopped", (n) => (n === 1 ? "stopped a thread" : `stopped ${n} threads`)],
    write_note: ["Saved", (n) => (n === 1 ? "saved a note" : `saved ${n} notes`)],
    read_note: ["Read", (n) => (n === 1 ? "read a note" : `read ${n} notes`)],
    list_notes: ["Listed notes", () => "listed notes"],
    read_source: ["Read source", () => "read the source"],
    list_threads: ["Listed threads", () => "listed threads"],
    read_thread: ["Read thread", (n) => (n === 1 ? "read a thread" : `read ${n} threads`)],
    mcp__pecia__list_threads: ["Read comments on", () => "read page comments"],
    set_status: ["Set status", () => "set status"],
    report: ["Filed report", () => "filed a report"],
    update_briefing: ["Updated briefing", () => "updated the briefing"],
    inform_thread: ["Informed", (n) => (n === 1 ? "informed a thread" : `informed ${n} threads`)],
  }),
);
const used = (tool: string): [string, (n: number) => string] =>
  words.get(tool) ?? [`Used ${tool}`, () => `used ${tool}`];
function summary(work: Array<Message>) {
  const counts = new Map<string, number>();
  for (const m of work) {
    if (m.step) {
      counts.set(m.step, (counts.get(m.step) ?? 0) + 1);
    }
  }
  const reports = work.filter((m) => m.role === "Child report").length;
  const parts = [...counts].map(([tool, n]) => used(tool)[1](n));
  if (reports) {
    parts.push(reports === 1 ? "got a report" : `got ${reports} reports`);
  }
  const failed = work.filter((m) => m.failed).length;
  const text = parts.join(", ") || "done";
  return `${text[0]?.toUpperCase()}${text.slice(1)}${failed ? ` · ${failed} failed` : ""}`;
}
const clock = (at?: number) =>
  at === undefined ? "" : new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

type Turn = { prompt?: Message; work: Array<Message>; final?: Message };
// One turn per human or forwarded message: the work it caused, then the response that ended it.
function turns(log: Array<Message>) {
  const out: Array<Turn> = [];
  for (const m of log) {
    // Each of these starts a turn: the person, a forwarded answer, news from below, or a note from above.
    if (["user", "Forwarded reply", "Update", "Notice"].includes(m.role)) {
      out.push({ prompt: m, work: [] });
      continue;
    }
    let last = out.at(-1);
    if (!last) {
      last = { work: [] };
      out.push(last);
    }
    const previous = last.work.at(-1);
    // Passive child reports can arrive twice (to the parent and its parent); show each once.
    if (previous?.role === m.role && previous.text === m.text && previous.from === m.from) {
      continue;
    }
    last.work.push(m);
  }
  for (const t of out) {
    const i = t.work.findLastIndex(
      (m) => m.report ?? (m.role === "assistant (streaming)" || (m.role === "assistant" && !m.step && m.text)),
    );
    const final = t.work[i];
    if (final) {
      t.final = final;
      t.work = t.work.filter((_, j) => j !== i);
    }
  }
  return out;
}
function Icon({ kind }: { kind: "agent" | "check" | "note" | "up" | "down" | "fail" }) {
  const paths = {
    agent: <circle cx="8" cy="8" r="5.5" />,
    check: <path d="M3.5 8.5l3 3 6-7" />,
    note: <path d="M4 2.5h6l2.5 2.5v8.5h-8.5zM6 7h4M6 10h4" />,
    up: <path d="M8 13V3M4 7l4-4 4 4" />,
    down: <path d="M8 3v10M4 9l4 4 4-4" />,
    fail: <path d="M4 4l8 8M12 4l-8 8" />,
  };
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      {paths[kind]}
    </svg>
  );
}
function Chevron({ open }: { open?: boolean }) {
  return (
    <svg className={`chev ${open ? "open" : ""}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="action"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
// About eight lines, then "Show more".
function Clamped({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null),
    [long, setLong] = useState(false),
    [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const e = ref.current;
    if (e && !open) {
      setLong(e.scrollHeight > e.clientHeight + 2);
    }
  }, [children, open]);
  return (
    <>
      <div ref={ref} className={`incoming-body ${open ? "" : "clamped"}`}>
        {children}
      </div>
      {long && (
        <button type="button" className="incoming-more" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
// Someone else's message: one header line (icon, who, what they did, when) that opens their thread, then the body.
function Incoming({
  p,
  from,
  name,
  verb,
  kind,
  at,
  children,
}: {
  p: Project;
  from?: Thread | undefined;
  name: string;
  verb: string;
  kind: "agent" | "up" | "down";
  at?: number | undefined;
  children: ReactNode;
}) {
  const head = (
    <>
      <span className="incoming-icon">
        <Icon kind={kind} />
      </span>
      <span className="incoming-line">
        <span className="incoming-name">{name}</span> {verb}
        {at !== undefined && <span className="message-time"> · {clock(at)}</span>}
      </span>
      {from && <Chevron />}
    </>
  );
  return (
    <div className="incoming">
      <div className="incoming-head">
        {from ? (
          <a className="incoming-from" href={href(p.id, "thread", from.id)} title={`Open ${name} in a tab`}>
            {head}
          </a>
        ) : (
          <span className="incoming-from">{head}</span>
        )}
      </div>
      <div className="incoming-content">
        <Clamped>{children}</Clamped>
      </div>
    </div>
  );
}
function Step({ p, m }: { p: Project; m: Message }) {
  const from = p.threads.find((x) => x.id === m.from);
  if (m.role === "Child report") {
    return (
      <li>
        <Icon kind="up" />
        <span className="label-text">
          Report from{" "}
          {from ? (
            <a className="label-object" href={href(p.id, "thread", from.id)}>
              {threadName(p, from)}
            </a>
          ) : (
            "below"
          )}
          <span className="label-extra"> {m.text}</span>
        </span>
      </li>
    );
  }
  if (m.role === "toolResult") {
    return m.failed ? (
      <li className="failed">
        <Icon kind="fail" />
        <span className="label-text">
          {used(m.tool ?? "")[0]} failed <span className="label-extra">{m.text}</span>
        </span>
      </li>
    ) : null;
  }
  if (m.step) {
    const target = p.threads.find((x) => x.id === m.object);
    return (
      <li>
        <Icon kind={m.step.includes("note") ? "note" : "check"} />
        <span className="label-text">
          {used(m.step)[0]}{" "}
          {target ? (
            <a className="label-object" href={href(p.id, "thread", target.id)}>
              {threadName(p, target)}
            </a>
          ) : (
            m.object && <b className="label-object">{m.object}</b>
          )}
        </span>
      </li>
    );
  }
  return m.text ? <li className="aside">{m.text}</li> : null;
}
// The work between a prompt and its answer: one quiet row that opens to its steps.
function Activity({ p, work, live }: { p: Project; work: Array<Message>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const count = work.filter((m) => m.step || m.role === "Child report").length;
  const current = work.findLast((m) => m.step);
  return (
    <div className="activity-block">
      <button
        type="button"
        className="activity"
        data-state={live ? "working" : "done"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {live ? <span className="wheel" aria-hidden /> : <Icon kind="check" />}
        <span className="label-text">
          {live ? (
            <>
              <b className="label-verb">{current?.step ? used(current.step)[0] : "Thinking"}</b>
              {current?.object && ` ${current.object}`}…
            </>
          ) : (
            summary(work)
          )}
        </span>
        <span className="activity-time">
          {count} {count === 1 ? "step" : "steps"}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <ul className="steps">
          {work.map((m, j) => (
            <Step key={j} p={p} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
function Answer({ p, m }: { p: Project; m: Message }) {
  const r = m.report;
  return (
    <div className="assistant">
      <Rich text={r ? r.result : m.text} />
      {r && (
        <dl className="report">
          <dt>Not done</dt>
          <dd>{r.notDone}</dd>
          <dt>Evidence</dt>
          <dd>{page.safeParse(r.where).success ? <a href={href(p.id, "notes", r.where)}>{r.where}</a> : r.where}</dd>
          <dt>Next</dt>
          <dd>{r.next}</dd>
          {r.waitingOn && (
            <>
              <dt>Waiting on</dt>
              <dd>{r.waitingOn}</dd>
            </>
          )}
        </dl>
      )}
      {m.role !== "assistant (streaming)" && (
        <div className="message-actions">
          {m.at !== undefined && <span className="message-time">{clock(m.at)}</span>}
          <Copy text={r ? r.result : m.text} />
        </div>
      )}
    </div>
  );
}
function Prompt({ p, t, m, first }: { p: Project; t: Thread; m: Message; first: boolean }) {
  const from = p.threads.find((x) => x.id === m.from);
  const parent = p.threads.find((c) => c.id === t.parent);
  if (m.role === "Update") {
    // An update's first line is the instruction to the agent; the person needs the report under it.
    return (
      <Incoming
        p={p}
        from={from}
        name={from ? threadName(p, from) : "A thread below"}
        verb="reported"
        kind="up"
        at={m.at}
      >
        <Rich text={m.text.split("\n").slice(1).join("\n")} />
      </Incoming>
    );
  }
  if (m.role === "Notice") {
    const above = p.threads.find((x) => x.role === m.from && x.id === t.parent);
    return (
      <Incoming
        p={p}
        from={above}
        name={above ? threadName(p, above) : (m.from ?? "Above")}
        verb="noted · no action requested"
        kind="down"
        at={m.at}
      >
        <Rich text={m.text} />
      </Incoming>
    );
  }
  const task = from ?? (first && parent ? parent : undefined);
  if (task && m.role === "user") {
    return (
      <Incoming p={p} from={task} name={threadName(p, task)} verb="asked" kind="down" at={m.at}>
        <Rich text={m.text} />
      </Incoming>
    );
  }
  return (
    <div className="user">
      {m.role === "Forwarded reply" && from && (
        <a className="speaker" href={href(p.id, "thread", from.id)}>
          Forwarded to {threadName(p, from)}
        </a>
      )}
      <div className="bubble">{m.text}</div>
      <div className="message-actions">
        {m.at !== undefined && <span className="message-time">{clock(m.at)}</span>}
        <Copy text={m.text} />
      </div>
    </div>
  );
}
function Transcript({ p, t, log, working }: { p: Project; t: Thread; log: Array<Message>; working: boolean }) {
  const all = turns(log);
  return (
    <div className="messages">
      {all.map((turn, i) => {
        const live = working && i === all.length - 1;
        return (
          <div className="turn" key={i}>
            {turn.prompt && <Prompt p={p} t={t} m={turn.prompt} first={i === 0} />}
            {(turn.work.some((m) => m.step || m.role === "Child report" || m.failed) || (live && !turn.final)) && (
              <Activity p={p} work={turn.work} live={live} />
            )}
            {turn.final && <Answer p={p} m={turn.final} />}
          </div>
        );
      })}
    </div>
  );
}
export function ThreadView({ t, p, offline }: { t: Thread; p: Project; offline: boolean }) {
  const path = `/api/projects/${p.id}/threads/${t.id}`;
  const { data, error } = useFeed(path, messages);
  const [sending, setSending] = useState(false),
    [issue, setIssue] = useState("");
  const scroller = useRef<HTMLDivElement>(null),
    [pinned, setPinned] = useState(true);
  let owner = t;
  while (owner.blockedBy) {
    const child = p.threads.find((c) => c.id === owner.blockedBy && c.parent === owner.id);
    if (!child) {
      break;
    }
    owner = child;
  }
  const blocked = offline || owner.busy || sending;
  const size = JSON.stringify(data ?? []).length;
  useEffect(() => {
    // Follow new output while the reader is at the bottom; leave them alone when they scroll up.
    if (pinned && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [size, pinned]);
  return (
    <div className="threadview">
      <div
        className="log"
        ref={scroller}
        onScroll={(e) => {
          const s = e.currentTarget;
          setPinned(s.scrollHeight - s.scrollTop - s.clientHeight < 40);
        }}
      >
        {owner.id !== t.id && (
          <p className="notice">
            This question belongs to <a href={href(p.id, "thread", owner.id)}>{threadName(p, owner)}</a>. A reply here
            goes directly there.
          </p>
        )}
        {error && !offline && <p>{error}</p>}
        {data && !data.length && <p className="quiet">No messages yet.</p>}
        {data && <Transcript p={p} t={t} log={data} working={t.busy} />}
      </div>
      <form
        className="composer"
        onSubmit={submit(async (form) => {
          if (blocked) {
            return;
          }
          setSending(true);
          setIssue("");
          try {
            await request(path, z.object({}), Object.fromEntries(new FormData(form)));
            setPinned(true);
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
            : `Message ${threadName(p, t)}`}
          <textarea
            name="text"
            required
            rows={2}
            maxLength={32_000}
            placeholder={owner.busy ? "Thread is working…" : "Write a message…"}
            title="Enter sends · Shift+Enter inserts a line break"
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
          Send
        </button>
      </form>
    </div>
  );
}
