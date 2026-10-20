import type { ReactNode } from "react";
import "../foundations.css";
import "./text.css";

/** Typographic roles. Pick one by its job, not by its size (DESIGN.md, "Type"). */
export type TextVariant = "body" | "callout" | "footnote" | "caption" | "headline" | "title" | "heading" | "voice" | "words" | "words-small" | "code";

/** Colours for text. Inside a Card or a Hud they become that surface's inks by themselves. */
export type TextTone = "default" | "secondary" | "accent" | "danger" | "ok";

type TextElement = "p" | "span" | "div" | "h1" | "h2" | "h3" | "small" | "code" | "blockquote";

const ELEMENT: Record<TextVariant, TextElement> = {
  body: "p",
  callout: "p",
  footnote: "p",
  caption: "span",
  headline: "p",
  title: "h1",
  heading: "h2",
  voice: "p",
  words: "p",
  "words-small": "p",
  code: "code",
};

export interface TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** The element, when the variant's default isn't right: a heading level, or inline text. */
  as?: TextElement;
  /** Keep to one line and cut the end with an ellipsis. */
  truncate?: boolean;
  /** Figures of equal width, for timers and counts. */
  numeric?: boolean;
  /** For the user's words: italic, as a quotation or a hint. */
  italic?: boolean;
  id?: string;
  children: ReactNode;
}

export function Text({ variant = "body", tone = "default", as, truncate, numeric, italic, id, children }: TextProps) {
  const Tag = as ?? ELEMENT[variant];
  return (
    <Tag
      id={id}
      className="av-text"
      data-variant={variant}
      data-tone={tone === "default" ? undefined : tone}
      data-truncate={truncate ? "" : undefined}
      data-numeric={numeric ? "" : undefined}
      data-italic={italic ? "" : undefined}
    >
      {children}
    </Tag>
  );
}
