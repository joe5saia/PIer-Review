import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import Markdown from "react-markdown";
import { href, index, request, useFeed, errorText, threadName, submit } from "./data.ts";
import type { Project, Thread } from "./data.ts";
import { Conversation } from "./thread.tsx";
import { name } from "../src/spec.ts";
import "./style.css";

const string = z.string(),
  paths = z.array(string);
const rule =
  "Start with a lowercase letter. Use lowercase letters, digits and single hyphens between words (up to 50 characters).";
function Intake({ sample, fixture }: { sample: string; fixture: boolean }) {
  const [error, setError] = useState(""),
    [nameError, setNameError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="eyebrow">Project intake</div>
      <h2>Open a research project</h2>
      <p className="quiet">
        {fixture
          ? "Try the offline survey: count visits or ask which site had the most."
          : "Each new project creates a Pecia workspace."}
      </p>
      <form
        noValidate
        onSubmit={submit(async (form) => {
          const id = String(new FormData(form).get("id") ?? "");
          if (!name.safeParse(id).success) {
            setNameError(id ? rule : "Enter a project name.");
            form.querySelector("input")?.focus();
            return;
          }
          if (!form.reportValidity()) {
            return;
          }
          setBusy(true);
          setError("");
          try {
            const t = await request(
              "/api/projects",
              z.object({ id: z.uuid() }),
              Object.fromEntries(new FormData(form)),
            );
            location.assign(href(id, "thread", t.id));
          } catch (error_) {
            const message = errorText(error_);
            if (/name|already exists/i.test(message)) {
              setNameError(message);
              form.querySelector("input")?.focus();
            } else {
              setError(message);
            }
          } finally {
            setBusy(false);
          }
        })}
      >
        <label htmlFor="name">Project name</label>
        <input
          id="name"
          name="id"
          title={rule}
          aria-describedby="name-help"
          aria-invalid={Boolean(nameError)}
          required
          maxLength={50}
          onChange={() => setNameError("")}
        />
        <small id="name-help">Example: harbor-survey. {nameError !== rule && rule}</small>
        {nameError && <p role="alert">{nameError}</p>}
        <label htmlFor="source">Source document</label>
        <textarea id="source" name="source" required rows={5} defaultValue={sample} maxLength={32_000} />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Opening project…" : "Create project"}
        </button>
      </form>
    </>
  );
}

function Source({ project }: { project: string }) {
  const path = `/api/projects/${project}/source`;
  const { data, error } = useFeed(path, string, false);
  const [status, setStatus] = useState("");
  return (
    <>
      <div className="eyebrow">Project material</div>
      <h2>Source document</h2>
      <p>Changes apply the next time a thread reads the source. Existing reports keep their original evidence.</p>
      {error && <p>{error}</p>}
      {data !== undefined && (
        <form
          onSubmit={submit(async (form) => {
            try {
              await request(path, z.object({}), Object.fromEntries(new FormData(form)));
              setStatus("Source saved.");
            } catch (error_) {
              setStatus(errorText(error_));
            }
          })}
        >
          <label>
            Source text
            <textarea
              name="source"
              required
              defaultValue={data}
              rows={10}
              maxLength={32_000}
              onChange={() => setStatus("")}
            />
          </label>
          <button type="submit">Save source</button>
          <p role="status">{status}</p>
        </form>
      )}
    </>
  );
}

function EvidencePage({ url }: { url: string }) {
  const { data, error } = useFeed(url, string, false);
  return (
    <div className="markdown">
      {error && <p role="alert">{error}</p>}
      <Markdown skipHtml disallowedElements={["img"]}>
        {data}
      </Markdown>
    </div>
  );
}
function Notes({ p, id }: { p: Project; id: string }) {
  const base = `/api/projects/${p.id}/notes`;
  const { data, error } = useFeed(base, paths, false);
  const ordered = (data ?? []).toSorted(
    (a, b) => p.pages.findIndex((n) => n.path === b) - p.pages.findIndex((n) => n.path === a),
  );
  return (
    <>
      <div className="eyebrow">Project notebook</div>
      <h2>{id ? "Evidence note" : "Notes"}</h2>
      {id && <a href={href(p.id, "notes")}>← All notes</a>}
      {error && <p>{error}</p>}
      {!id && !ordered.length && <p>No notes yet.</p>}
      {(id ? [id] : ordered).map((path) => {
        const meta = p.pages.find((n) => n.path === path);
        const cited = p.threads.filter((t) => t.reports.some((r) => r.where === path));
        const author = p.threads.find((t) => t.id === meta?.author);
        const title = author?.title ?? cited.at(-1)?.title ?? path;
        return (
          <article key={path}>
            <div className="eyebrow">{meta ? new Date(meta.at).toLocaleString() : "Project note"}</div>
            <h3>
              <a href={href(p.id, "notes", path)}>{title}</a>
            </h3>
            <small>{path}</small>
            {author && (
              <p>
                Written by <a href={href(p.id, "thread", author.id)}>{threadName(p, author)}</a>
              </p>
            )}
            {cited.map((t) => (
              <p key={t.id}>
                <a href={href(p.id, "thread", t.id)}>{threadName(p, t)} report</a> ·{" "}
                {t.reports.findLast((r) => r.where === path)?.result}
              </p>
            ))}
            {id && <EvidencePage url={`${base}?path=${encodeURIComponent(path)}`} />}
          </article>
        );
      })}
    </>
  );
}

function Tree({ p, parent, selected }: { p: Project; parent: string | null; selected: string }) {
  const children = p.threads.filter((t) => t.parent === parent);
  return children.length ? (
    <ul>
      {children.map((t) => (
        <li key={t.id}>
          <a href={href(p.id, "thread", t.id)} aria-current={selected === t.id ? "page" : undefined}>
            <strong>{threadName(p, t)}</strong>
            <span>{t.title}</span>
            <small>{t.status}</small>
          </a>
          <Tree p={p} parent={t.id} selected={selected} />
        </li>
      ))}
    </ul>
  ) : null;
}
function App() {
  const { data, error } = useFeed("/api/projects", index);
  const [hash, setHash] = useState(location.hash),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    const change = () => {
      setHash(location.hash);
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const route = new URLSearchParams(hash.slice(1));
  const view = route.get("view") ?? "thread",
    id = route.get("id") ?? "",
    slug = route.get("project");
  const p = slug ? data?.projects.find((x) => x.id === slug) : data?.projects[0];
  const t: Thread | undefined = id ? p?.threads.find((x) => x.id === id) : p?.threads[0];
  const intake = view === "new" || (!slug && !p);
  return (
    <>
      <header>
        <b>≋ &nbsp; Pier Review</b>
        <span>Research desk</span>
        <em>{data?.mode ?? "Connecting"} mode</em>
      </header>
      <main>
        {error && (
          <p className="notice" role="status">
            {error}
          </p>
        )}
        <div className="desk">
          <button type="button" className="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            Projects & threads {menu ? "▴" : "▾"}
          </button>
          <nav className={menu ? "shown" : ""} aria-label="Projects and threads">
            <div className="eyebrow">Projects</div>
            {data?.projects.map((x) => (
              <a
                key={x.id}
                href={href(x.id, "thread", x.threads[0]?.id)}
                className={x.id === p?.id && !intake ? "current" : ""}
              >
                {x.id}
              </a>
            ))}
            <a href={href("", "new")}>＋ New project</a>
            {p && !intake && (
              <>
                <div className="eyebrow group">Threads · {p.threads.length}</div>
                <Tree p={p} parent={null} selected={view === "thread" ? (t?.id ?? "") : ""} />
                <a href={href(p.id, "source")}>Source document</a>
                <a href={href(p.id, "notes")}>Project notes</a>
              </>
            )}
          </nav>
          <section key={`${slug}/${view}/${id}`}>
            <div className="breadcrumb">Field desk {p && !intake && ` / ${p.id}`}</div>
            {!data && !error && <p>Connecting to the desk…</p>}
            {data && intake && <Intake fixture={data.mode === "fixture"} sample={data.sample} />}{" "}
            {data && !intake && !p && (
              <p>
                Looking for this project… <a href={href("", "new")}>Open project intake</a>
              </p>
            )}
            {p && !intake && view === "notes" && <Notes p={p} id={id} />}{" "}
            {p && !intake && view === "source" && <Source project={p.id} />}{" "}
            {p &&
              !intake &&
              view === "thread" &&
              (t ? <Conversation t={t} p={p} offline={Boolean(error)} /> : <p>Thread not found.</p>)}
          </section>
        </div>
      </main>
    </>
  );
}
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
