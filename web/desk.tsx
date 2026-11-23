import { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { href, index, request, useFeed, errorText, threadName, submit, spaceStatus } from "./data.ts";
import type { Project, Thread } from "./data.ts";
import { ThreadView } from "./thread.tsx";
import { Rich, HtmlFrame } from "./markdown.tsx";
import { name } from "../src/spec.ts";
import "@fontsource-variable/jost/wght.css";
import "./style.css";

const string = z.string(),
  paths = z.array(string);
const rule = "Lowercase letters, digits and single hyphens, starting with a letter.";
// The only step to a new space: name it, press Enter, and it opens.
function NewSpace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) {
      setError("");
      d.showModal();
    }
    if (!open && d?.open) {
      d.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="newspace"
      aria-label="New space"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        noValidate
        onSubmit={submit(async (form) => {
          const id = String(new FormData(form).get("id") ?? "").trim();
          if (!name.safeParse(id).success) {
            setError(id ? rule : "Enter a space name.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await request("/api/projects", z.object({ id: z.uuid() }), { id });
            form.reset();
            onClose();
            location.assign(href(id, "space"));
          } catch (error_) {
            setError(errorText(error_));
          } finally {
            setBusy(false);
          }
        })}
      >
        <label htmlFor="space-name" className="eyebrow">
          New space
        </label>
        <input
          id="space-name"
          name="id"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. wetland-count"
          maxLength={50}
          aria-invalid={Boolean(error)}
          disabled={busy}
          onChange={() => setError("")}
        />
        <p className={error ? "" : "quiet"} role={error ? "alert" : undefined}>
          {error || (busy ? "Opening space…" : "Enter creates and opens it · Esc cancels")}
        </p>
      </form>
    </dialog>
  );
}

function Source({ project }: { project: string }) {
  const path = `/api/projects/${project}/source`,
    key = keyOf({ type: "source" });
  const { data, error } = useFeed(path, string, false);
  const [status, setStatus] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      unsaved.delete(key);
      return;
    }
    unsaved.add(key);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      unsaved.delete(key);
    };
  }, [dirty, key]);
  return (
    <div className="pad">
      <p className="quiet">
        Changes apply the next time a thread reads the source. Existing reports keep their original evidence.
      </p>
      {error && <p>{error}</p>}
      {data !== undefined && (
        <form
          onSubmit={submit(async (form) => {
            try {
              await request(path, z.object({}), Object.fromEntries(new FormData(form)));
              setStatus("Source saved.");
              setDirty(false);
            } catch (error_) {
              setStatus(errorText(error_));
            }
          })}
        >
          <label>
            Source text {dirty && <em>· unsaved changes</em>}
            <textarea
              name="source"
              required
              defaultValue={data}
              rows={12}
              maxLength={32_000}
              onChange={() => {
                setStatus("");
                setDirty(true);
              }}
            />
          </label>
          <button type="submit">Save source</button>
          <p role="status">{status}</p>
        </form>
      )}
    </div>
  );
}

function Note({ p, path }: { p: Project; path: string }) {
  const { data, error } = useFeed(`/api/projects/${p.id}/notes?path=${encodeURIComponent(path)}`, string, false);
  const meta = p.pages.find((n) => n.path === path);
  const author = p.threads.find((t) => t.id === meta?.author);
  return (
    <div className="pad">
      <small className="quiet">
        {path}
        {author && (
          <>
            {" · written by "}
            <a href={href(p.id, "thread", author.id)}>{threadName(p, author)}</a>
          </>
        )}
        {meta && ` · ${new Date(meta.at).toLocaleString()}`}
      </small>
      {error && <p role="alert">{error}</p>}
      {data !== undefined && <Rich text={data} />}
    </div>
  );
}
function Notes({ p }: { p: Project }) {
  const { data, error } = useFeed(`/api/projects/${p.id}/notes`, paths);
  const ordered = (data ?? []).toSorted(
    (a, b) => p.pages.findIndex((n) => n.path === b) - p.pages.findIndex((n) => n.path === a),
  );
  return (
    <div className="pad">
      {error && <p>{error}</p>}
      {data && !ordered.length && <p className="quiet">No notes yet.</p>}
      <ul className="notes">
        {ordered.map((path) => {
          const cited = p.threads.filter((t) => t.reports.some((r) => r.where === path));
          return (
            <li key={path}>
              <a href={href(p.id, "notes", path)}>{path}</a>
              {cited.map((t) => (
                <small key={t.id}>
                  {threadName(p, t)}: {t.reports.findLast((r) => r.where === path)?.result}
                </small>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Tab =
  | { type: "briefing" }
  | { type: "thread"; id: string }
  | { type: "notes" }
  | { type: "note"; path: string }
  | { type: "source" };
const tab = z.discriminatedUnion("type", [
  z.object({ type: z.literal("briefing") }),
  z.object({ type: z.literal("thread"), id: z.string() }),
  z.object({ type: z.literal("notes") }),
  z.object({ type: z.literal("note"), path: z.string() }),
  z.object({ type: z.literal("source") }),
]);
const keyOf = (t: Tab) => {
  if (t.type === "thread") {
    return `thread:${t.id}`;
  }
  return t.type === "note" ? `note:${t.path}` : t.type;
};
const parse = (hash: string) => new URLSearchParams(hash.replace(/^#/, ""));
function tabFor(route: URLSearchParams): Tab | undefined {
  const view = route.get("view"),
    id = route.get("id") ?? "";
  if (view === "thread" && id) {
    return { type: "thread", id };
  }
  if (view === "notes") {
    return id ? { type: "note", path: id } : { type: "notes" };
  }
  return view === "source" ? { type: "source" } : undefined;
}
// Unsaved editors register here so closing their tab asks first.
const unsaved = new Set<string>();
const briefingTab: Tab = { type: "briefing" };
const opened = z.object({ tabs: z.array(tab), active: z.string() });
// Open tabs are a view preference of this browser, kept per space.
function useTabs(space: string) {
  const load = useCallback(() => {
    const saved = opened.safeParse(JSON.parse(localStorage.getItem(`pier.tabs.${space}`) ?? "null")).data ?? {
      tabs: [briefingTab],
      active: "briefing",
    };
    // A bookmarked thread or note opens as a tab in its space.
    const route = parse(location.hash),
      t = route.get("project") === space ? tabFor(route) : undefined;
    if (!t) {
      return saved;
    }
    const tabs = saved.tabs.some((x) => keyOf(x) === keyOf(t)) ? saved.tabs : [...saved.tabs, t];
    return { tabs, active: keyOf(t) };
  }, [space]);
  const [state, setState] = useState(() => ({ space, ...load() }));
  const current = state.space === space ? state : { space, ...load() };
  const change = useCallback(
    (f: (s: z.infer<typeof opened>) => z.infer<typeof opened>) => {
      setState((prev) => {
        const next = f(prev.space === space ? prev : load());
        localStorage.setItem(`pier.tabs.${space}`, JSON.stringify(next));
        return { space, ...next };
      });
    },
    [space, load],
  );
  const open = useCallback(
    (t: Tab) =>
      change((s) => ({
        tabs: s.tabs.some((x) => keyOf(x) === keyOf(t)) ? s.tabs : [...s.tabs, t],
        active: keyOf(t),
      })),
    [change],
  );
  const close = (key: string) => {
    if (key === "briefing" || (unsaved.has(key) && !confirm("Discard unsaved changes in this tab?"))) {
      return;
    }
    change((s) => {
      const i = s.tabs.findIndex((x) => keyOf(x) === key);
      const tabs = s.tabs.filter((x) => keyOf(x) !== key);
      const active = s.active === key ? keyOf(tabs[Math.max(0, i - 1)] ?? briefingTab) : s.active;
      return { tabs, active };
    });
  };
  return {
    tabs: current.tabs,
    active: current.active,
    open,
    close,
    focus: (key: string) => change((s) => ({ ...s, active: key })),
  };
}

const statusClass = (t: Thread) => {
  if (t.waiting) {
    return "needs-input";
  }
  return t.busy ? "working" : "idle";
};
function Tree({ p, parent, open }: { p: Project; parent: string | null; open: (id: string) => void }) {
  const children = p.threads.filter((t) => t.parent === parent);
  return children.length ? (
    <ul>
      {children.map((t) => (
        <li key={t.id}>
          <button type="button" className={`node ${statusClass(t)}`} onClick={() => open(t.id)}>
            <i className="dot" />
            <span>
              <b>{threadName(p, t)}</b> · {t.title}
              <small>{t.waiting ? `Needs input: ${t.reports.at(-1)?.waitingOn ?? ""}` : t.status}</small>
              {t.reports.at(-1) && <em>{t.reports.at(-1)?.result}</em>}
            </span>
          </button>
          <Tree p={p} parent={t.id} open={open} />
        </li>
      ))}
    </ul>
  ) : null;
}

// The briefing: goals at a glance from the desk's own records, then the coordinator's running HTML account.
function Briefing({ p, open }: { p: Project; open: (id: string) => void }) {
  const { data } = useFeed(`/api/projects/${p.id}/briefing`, string);
  const top = p.threads.find((t) => t.parent === null);
  const below = p.threads.filter((t) => t.parent !== null);
  const recent = below.toReversed();
  return (
    <div className="pad briefing">
      <section className="goal">
        <div className="eyebrow">Top-level goal</div>
        <h2>{top?.goal ?? "No goal yet. Ask the coordinator for something."}</h2>
        {top && (
          <p className="quiet">
            Coordinator · {top.waiting ? "needs your input" : top.status}
            {top.reports.at(-1) && ` · latest: ${top.reports.at(-1)?.result}`}
          </p>
        )}
      </section>
      {recent.length > 0 && (
        <section>
          <div className="eyebrow">Sub-goals</div>
          <div className="cards">
            {recent.map((t) => (
              <button type="button" key={t.id} className={`card ${statusClass(t)}`} onClick={() => open(t.id)}>
                <small>
                  {threadName(p, t)} · {t.waiting ? "Needs input" : t.status}
                </small>
                <b>{t.goal ?? t.title}</b>
                {t.reports.at(-1) && <span>{t.reports.at(-1)?.result}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="eyebrow">From the coordinator</div>
        {data ? (
          <HtmlFrame html={data} onOpen={open} />
        ) : (
          <p className="quiet">The coordinator writes its briefing here once work starts.</p>
        )}
      </section>
    </div>
  );
}

function ThreadHeader({ p, t, open }: { p: Project; t: Thread; open: (id: string) => void }) {
  const chain: Array<Thread> = [];
  let up = p.threads.find((x) => x.id === t.parent);
  while (up) {
    chain.unshift(up);
    const id = up.parent;
    up = p.threads.find((x) => x.id === id);
  }
  return (
    <header className="threadhead">
      <nav aria-label="Thread chain">
        {chain.map((c) => (
          <button type="button" className="link" key={c.id} onClick={() => open(c.id)}>
            {threadName(p, c)} ›
          </button>
        ))}
        <span>{threadName(p, t)}</span>
      </nav>
      <h2>{t.goal ?? t.title}</h2>
      <small className={`status ${statusClass(t)}`}>{t.waiting ? "Needs input" : t.status}</small>
    </header>
  );
}

function App() {
  const { data, error } = useFeed("/api/projects", index);
  const [route, setRoute] = useState(() => parse(location.hash));
  const [tree, setTree] = useState(false);
  const slug = route.get("project") ?? localStorage.getItem("pier.space") ?? "";
  const p = data?.projects.find((x) => x.id === slug) ?? (slug ? undefined : data?.projects[0]);
  const coordinator = p?.threads.find((t) => t.parent === null);
  const [naming, setNaming] = useState(false);
  const empty = data && !data.projects.length;
  const { tabs, active, open, close, focus } = useTabs(p?.id ?? "");
  const openThread = useCallback(
    (id: string) => {
      open({ type: "thread", id });
      setTree(false);
    },
    [open],
  );
  // In-app links open tabs, even when the hash is already current.
  const go = useCallback(
    (hash: string) => {
      const next = parse(hash);
      setRoute(next);
      const target = next.get("project");
      if (target) {
        localStorage.setItem("pier.space", target);
      }
      const t = tabFor(next);
      if (t && (!target || target === p?.id)) {
        open(t);
      }
    },
    [open, p?.id],
  );
  useEffect(() => {
    const change = () => go(location.hash);
    const click = (e: MouseEvent) => {
      const target = z.instanceof(Element).safeParse(e.target).data?.closest("a")?.getAttribute("href");
      if (target?.startsWith("#") && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        history.pushState(null, "", target);
        go(target);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTree(false);
      }
    };
    window.addEventListener("hashchange", change);
    window.addEventListener("keydown", key);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("keydown", key);
      document.removeEventListener("click", click);
    };
  }, [go]);
  const title = (t: Tab) => {
    if (t.type === "thread") {
      const th = p?.threads.find((x) => x.id === t.id);
      return th && p ? `${threadName(p, th)} · ${th.title}` : "Thread";
    }
    if (t.type === "note") {
      return t.path;
    }
    return { briefing: "Briefing", notes: "Notes", source: "Source" }[t.type];
  };
  const body = (t: Tab) => {
    if (!p) {
      return null;
    }
    if (t.type === "briefing") {
      return <Briefing p={p} open={openThread} />;
    }
    if (t.type === "thread") {
      const th = p.threads.find((x) => x.id === t.id);
      return th ? (
        <div className="threadtab">
          <ThreadHeader p={p} t={th} open={openThread} />
          <ThreadView t={th} p={p} offline={Boolean(error)} />
        </div>
      ) : (
        <p className="pad">Thread not found.</p>
      );
    }
    if (t.type === "note") {
      return <Note p={p} path={t.path} />;
    }
    return t.type === "notes" ? <Notes p={p} /> : <Source project={p.id} />;
  };
  const shown = tabs.find((t) => keyOf(t) === active) ?? briefingTab;
  return (
    <div className="app">
      <nav aria-label="Spaces">
        <div className="brand">
          <b>Pier Review</b>
          <em>{data?.mode ?? "connecting"}</em>
        </div>
        <div className="eyebrow">Spaces</div>
        {data?.projects.map((x) => {
          const status = spaceStatus(x);
          return (
            <div key={x.id} className={x.id === p?.id ? "space current" : "space"}>
              <a href={href(x.id, "space")}>
                <span>{x.id}</span>
                <small className={`status ${status.replace(" ", "-").toLowerCase()}`}>{status}</small>
              </a>
              {x.id === p?.id && (
                <div className="contents">
                  <a href={href(x.id, "notes")}>Notes · {x.pages.length}</a>
                  <a href={href(x.id, "source")}>Source document</a>
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="new" onClick={() => setNaming(true)}>
          ＋ New space
        </button>
        {error && (
          <p className="notice" role="status">
            {error}
          </p>
        )}
      </nav>
      {!data && !error && <p className="pad">Connecting to the desk…</p>}
      <NewSpace open={naming || Boolean(empty)} onClose={() => setNaming(false)} />
      {data && !p && (
        <p className="pad">
          {empty ? "No spaces yet." : "Looking for this space…"}{" "}
          <button type="button" className="link" onClick={() => setNaming(true)}>
            Create a space
          </button>
        </p>
      )}
      {p && (
        <>
          <section className="coordinator" aria-label="Coordinator">
            <header>
              <div className="eyebrow">Coordinator</div>
              <h1>{p.id}</h1>
            </header>
            {coordinator && <ThreadView key={coordinator.id} t={coordinator} p={p} offline={Boolean(error)} />}
          </section>
          <section className="main" aria-label="Space">
            <div className="tabbar" role="tablist">
              {tabs.map((t) => {
                const k = keyOf(t);
                return (
                  <div key={k} className={k === keyOf(shown) ? "tab active" : "tab"}>
                    <button type="button" role="tab" aria-selected={k === keyOf(shown)} onClick={() => focus(k)}>
                      {title(t)}
                    </button>
                    {t.type !== "briefing" && (
                      <button type="button" className="x" aria-label={`Close ${title(t)}`} onClick={() => close(k)}>
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              <button type="button" className="treebutton" aria-expanded={tree} onClick={() => setTree(!tree)}>
                Threads · {p.threads.length}
              </button>
            </div>
            <div className="tabbody" key={keyOf(shown)}>
              {body(shown)}
            </div>
            {tree && (
              <>
                <button type="button" className="scrim" aria-label="Close threads" onClick={() => setTree(false)} />
                <aside className="flyout" aria-label="Conversation tree">
                  <header>
                    <div className="eyebrow">Conversation tree</div>
                    <button type="button" className="x" aria-label="Close threads" onClick={() => setTree(false)}>
                      ×
                    </button>
                  </header>
                  <Tree p={p} parent={null} open={openThread} />
                </aside>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
