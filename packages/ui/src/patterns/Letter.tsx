import type { ReactNode } from "react";
import { Stamp } from "../components/Stamp.tsx";
import { Zel } from "../components/Zel.tsx";
import "../foundations.css";
import "./letter.css";

export interface LetterProps {
  /** "Tuesday, 20 October". */
  date: string;
  /** Paragraphs, <h3> headings, lists and quotes, written by Zel in the first person. */
  children: ReactNode;
  /** The stamp's date line, "20 Oct 2026". Leave it out for a letter that isn't finished. */
  stampDate?: string;
}

/** The evening letter: the ending of the day, on ruled paper, signed by Zel. */
export function Letter({ date, children, stampDate }: LetterProps) {
  return (
    <article className="av-letter">
      <header className="av-letter-date">{date}</header>
      <div className="av-letter-body">
        {children}
        <footer className="av-letter-sig">
          <Zel mood="idle" size="small" animate={false} />
          <span>Zel</span>
        </footer>
      </div>
      {stampDate && <span className="av-letter-stamp"><Stamp word="letter" date={stampDate} /></span>}
    </article>
  );
}
