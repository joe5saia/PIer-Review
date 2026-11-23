import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { errorText } from "./data.ts";

// Text of a hast node, without depending on hast's types.
function textOf(node: unknown): string {
  if (typeof node !== "object" || node === null) {
    return "";
  }
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  return "children" in node && Array.isArray(node.children) ? node.children.map(textOf).join("") : "";
}
function language(node: unknown) {
  const code = z.object({ children: z.array(z.unknown()) }).safeParse(node).data?.children[0];
  const parsed = z
    .object({ tagName: z.literal("code"), properties: z.object({ className: z.array(z.string()).optional() }) })
    .safeParse(code);
  return parsed.success ? { lang: parsed.data.properties.className?.[0] ?? "", text: textOf(code) } : undefined;
}

let renders = 0;
function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null),
    [issue, setIssue] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#fbf6ea",
            primaryBorderColor: "#5a3a22",
            lineColor: "#5a3a22",
            fontFamily: "Jost Variable, Futura, Avenir, sans-serif",
          },
        });
        const { svg } = await mermaid.render(`mermaid-${++renders}`, code);
        if (live && ref.current) {
          // Mermaid's strict security level sanitizes the SVG it returns.
          ref.current.innerHTML = svg;
          setIssue("");
        }
      } catch (error) {
        if (live) {
          setIssue(errorText(error));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);
  return issue ? (
    <pre title={`Diagram failed: ${issue}`}>{code}</pre>
  ) : (
    <div className="diagram" ref={ref} role="img" aria-label="Diagram" />
  );
}

// Agent HTML runs in /frame: an opaque-origin sandbox whose CSP blocks all network access.
export function HtmlFrame({
  html,
  fill = false,
  onOpen,
}: {
  html: string;
  fill?: boolean;
  onOpen?: (id: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null),
    [height, setHeight] = useState(120);
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) {
        return;
      }
      const size = z.object({ h: z.number() }).safeParse(e.data);
      if (size.success) {
        setHeight(Math.min(Math.max(size.data.h, 40), 2400));
      }
      const open = z.object({ open: z.string().max(64) }).safeParse(e.data);
      if (open.success) {
        onOpen?.(open.data.open);
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [onOpen]);
  return (
    <iframe
      key={html}
      ref={ref}
      className={fill ? "htmlblock fill" : "htmlblock"}
      title="HTML block"
      sandbox="allow-scripts"
      src="/frame"
      style={fill ? undefined : { height }}
      onLoad={() => ref.current?.contentWindow?.postMessage(html, "*")}
    />
  );
}

// Module scope: a new components object per render would remount diagrams and frames on every poll.
const components: Components = {
  pre({ node, children }) {
    const block = language(node);
    if (block?.lang === "language-mermaid") {
      return <Mermaid code={block.text} />;
    }
    if (block?.lang === "language-html") {
      return <HtmlFrame html={block.text} />;
    }
    return <pre>{children}</pre>;
  },
};
export function Rich({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
