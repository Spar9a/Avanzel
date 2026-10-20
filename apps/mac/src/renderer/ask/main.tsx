import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AskResult, AvanzelBridge } from "../../shared/ipc.ts";
import "../common/mac.css";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

interface Turn {
  question: string;
  result: AskResult | null;
}

/** Markdown answer → safe HTML, with [[page]] wikilinks turned into clickable links. */
function render(answer: string): string {
  const linked = answer.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) =>
    `<a href="#" data-page="${name.trim().replace(/"/g, "&quot;")}">${(label ?? name).trim()}</a>`);
  return DOMPurify.sanitize(marked.parse(linked, { async: false }) as string, { ADD_ATTR: ["data-page"] });
}

function Ask() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  /** What the pending question is doing now, as main last reported it (null: nothing reported yet). */
  const [progress, setProgress] = useState<string | null>(null);
  const busy = turns.some((t) => t.result === null);

  useEffect(() => window.avanzel.ask.onProgress(setProgress), []);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    setProgress(null);
    setTurns((prev) => [{ question: q, result: null }, ...prev]);
    const result = await window.avanzel.ask.ask(q);
    setTurns((prev) => prev.map((t) => (t.question === q && t.result === null ? { question: q, result } : t)));
  };

  return (
    <main className="ask">
      <div className="titlebar" />
      <input
        type="text"
        autoFocus
        aria-label="Ask your library"
        placeholder="Ask your library…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void ask();
          if (e.key === "Escape") window.avanzel.ask.close();
        }}
      />
      <div
        className="turns"
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest("a[data-page]");
          if (link) {
            e.preventDefault();
            window.avanzel.ask.openPage(link.getAttribute("data-page") ?? "");
          }
        }}
      >
        {turns.length === 0 && <p className="empty">Answers come from your library only, with links to the pages they use.</p>}
        {turns.map((turn, i) => (
          <article key={turns.length - i}>
            <h2>{turn.question}</h2>
            {turn.result === null ? (
              <p className="pending"><span className="spin" />{progress ?? "Looking through your library…"}</p>
            ) : turn.result.ok ? (
              <>
                <div className="answer" dangerouslySetInnerHTML={{ __html: render(turn.result.answer) }} />
                <p className="meta">{turn.result.agent} answered in {Math.round(turn.result.seconds)} s</p>
              </>
            ) : (
              <p className="error">{turn.result.answer}</p>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Ask />);
