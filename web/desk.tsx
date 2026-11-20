import { useState, useEffect } from "react";
import type { SubmitEvent } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import "./style.css";

const report = z.object({
  result: z.string(),
  notDone: z.string(),
  where: z.string(),
  next: z.string(),
  waitingOn: z.string().optional(),
});
const thread = z.object({
  id: z.string(),
  title: z.string(),
  role: z.string(),
  status: z.string(),
  waiting: z.boolean(),
  reports: z.array(report),
});
const index = z.object({
  mode: z.string(),
  sample: z.string(),
  projects: z.array(z.object({ id: z.string(), threads: z.array(thread) })),
});
const messages = z.array(z.object({ role: z.string(), text: z.string() }));
async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {},
  );
  if (!r.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(await r.json());
    throw new Error(parsed.success ? parsed.data.error : r.statusText);
  }
  return schema.parse(await r.json());
}
function useFeed<T>(path: string, schema: z.ZodType<T>, repeat = true) {
  const [data, set] = useState<T>();
  const [error, fail] = useState("");
  useEffect(() => {
    let open = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await request(path, schema);
        if (open) {
          set(value);
          fail("");
        }
      } catch (error_) {
        if (open) {
          fail(String(error_));
        }
      } finally {
        if (open && repeat) {
          timer = setTimeout(load, 800);
        }
      }
    }
    void load();
    return () => {
      open = false;
      clearTimeout(timer);
    };
  }, [path, repeat, schema]);
  return { data, error };
}
function Form({
  create,
  onDone,
  sample,
  path,
}: {
  create: boolean;
  onDone: (id: string) => void;
  sample: string;
  path: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, fail] = useState("");
  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setBusy(true);
    fail("");
    try {
      await request(path, z.object({}), data);
      onDone(String(data.id ?? ""));
      form.reset();
    } catch (error_) {
      fail(String(error_));
    } finally {
      setBusy(false);
    }
  }
  const label = create ? "Create project" : "Send message";
  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      {create ? (
        <>
          <label>
            Project name
            <input
              name="id"
              placeholder="harbor-survey"
              pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
              required
              maxLength={50}
            />
          </label>
          <label>
            Source document
            <textarea name="source" defaultValue={sample} rows={6} required maxLength={32_000} />
          </label>
        </>
      ) : (
        <label>
          Message this thread
          <textarea placeholder="What should we investigate?" name="text" rows={2} required maxLength={32_000} />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Working…" : label} →
      </button>
    </form>
  );
}
function Conversation({ t, project }: { t: z.infer<typeof thread>; project: string }) {
  const path = `/api/projects/${project}/threads/${t.id}`;
  const { data, error } = useFeed(path, messages);
  return (
    <>
      <div className="eyebrow">Thread / {t.role}</div>
      <h2>{t.title}</h2>
      <span className="badge">
        {t.waiting && t.status !== "Waiting on input" ? "Waiting on input · " : ""}
        {t.status}
      </span>
      {t.reports.map((r, i) => (
        <article key={i}>
          <div className="eyebrow">Field report · {i + 1}</div>
          <h3>{r.result}</h3>
          <dl>
            {Object.entries(r)
              .filter(([k]) => k !== "result")
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{{ notDone: "Not done", where: "Where", next: "Next", waitingOn: "Waiting on" }[k]}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </article>
      ))}
      <h4>Transcript</h4>
      {error && <p role="alert">{error}</p>}
      {data?.length ? (
        data.map((m, i) => (
          <details key={i} open={m.role === "user"}>
            <summary>
              {m.role === "user" ? "Researcher input" : m.role} · {m.text.slice(0, 72)}
              {m.text.length > 72 ? "…" : ""}
            </summary>
            <pre>{m.text}</pre>
          </details>
        ))
      ) : (
        <p className="quiet">No messages yet. Send the first research question below.</p>
      )}
      <Form create={false} sample="" path={path} onDone={() => {}} />
    </>
  );
}
const pages = z.array(z.string()),
  markdown = z.string();
function Page({ path }: { path: string }) {
  const { data, error } = useFeed(path, markdown, false);
  return <pre>{error || data}</pre>;
}
function Notes({ id }: { id: string }) {
  const base = `/api/projects/${id}/notes`,
    { data, error } = useFeed(base, pages, false);
  return (
    <>
      <div className="eyebrow">Project notebook</div>
      <h2>Notes</h2>
      {error && <p role="alert">{error}</p>}
      {data?.length ? (
        data.map((p) => (
          <details key={p}>
            <summary>{p}</summary>
            <Page path={`${base}?path=${encodeURIComponent(p)}`} />
          </details>
        ))
      ) : (
        <p className="quiet">Notes written by agents appear here.</p>
      )}
    </>
  );
}
function App() {
  const { data, error } = useFeed("/api/projects", index);
  const [projectId, select] = useState(""),
    [threadId, threadSelect] = useState(""),
    [newProject, create] = useState(false),
    [notes, setNotes] = useState(false);
  const p = projectId ? data?.projects.find((v) => v.id === projectId) : data?.projects[0];
  const t = p?.threads.find((v) => v.id === threadId) ?? p?.threads[0];
  const editing = newProject || (!projectId && !p);
  return (
    <>
      <header>
        <b>≋ &nbsp; Pier Review</b>
        <span>Research desk</span>
        <em>{data?.mode ?? "Connecting"} mode</em>
      </header>
      <main>
        <div className="mast">
          <div className="eyebrow">Pier Review &nbsp; / &nbsp; Research workspace</div>
          <h1>
            Field desk<span>.</span>
          </h1>
          <p>Coordinate source research, follow agent threads, and read their findings.</p>
        </div>
        <div className="desk">
          <nav>
            <div className="eyebrow">
              Projects <small>{data?.projects.length ?? 0}</small>
            </div>
            {data?.projects.map((v) => (
              <button
                type="button"
                className={!editing && v === p ? "active" : ""}
                key={v.id}
                onClick={() => {
                  select(v.id);
                  threadSelect("");
                  create(false);
                  setNotes(false);
                }}
              >
                {v.id}
              </button>
            ))}
            <button type="button" className="add" onClick={() => create(true)}>
              ＋ New project
            </button>
            {p && !editing && (
              <>
                <div className="eyebrow group">
                  Threads <small>{p.threads.length}</small>
                </div>
                {p.threads.map((th) => (
                  <button
                    type="button"
                    key={th.id}
                    className={th.id === t?.id && !notes ? "active" : ""}
                    onClick={() => {
                      threadSelect(th.id);
                      setNotes(false);
                    }}
                  >
                    <strong>{th.role}</strong>
                    <small>{th.waiting ? "Waiting on input" : th.status}</small>
                  </button>
                ))}
                <button type="button" className="add" onClick={() => setNotes(true)}>
                  ▤ Project notes
                </button>
              </>
            )}
          </nav>
          <section>
            {error && <p role="alert">{error}</p>}
            {!data && <p>Connecting to the desk…</p>}
            {data && !p && !editing && <p>Opening project…</p>}
            {data && editing && (
              <>
                <div className="eyebrow">Project intake</div>
                <h2>Open a research project</h2>
                <p className="quiet">
                  Give the coordinator a source to work from.{" "}
                  {data.mode === "fixture"
                    ? "The offline fixture analyzes numeric survey rows."
                    : "A new project provisions its own Pecia workspace."}
                </p>
                <Form
                  create
                  sample={data.sample}
                  path="/api/projects"
                  onDone={(id) => {
                    select(id);
                    create(false);
                    setNotes(false);
                  }}
                />
              </>
            )}
            {!editing && p && notes && <Notes key={p.id} id={p.id} />}
            {!editing && !notes && p && t && <Conversation key={t.id} t={t} project={p.id} />}
          </section>
        </div>
        <footer>PIER REVIEW &nbsp; / &nbsp; LOCAL RESEARCH APP</footer>
      </main>
    </>
  );
}
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
