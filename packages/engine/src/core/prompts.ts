// Task prompts handed to the harness. Each is self-contained, so harnesses that do not auto-load
// AGENTS.md still know the rules; the first line names the task for logs and test doubles.

import { localDate, localMinute } from "./dates.ts";
import { render, substitute } from "./templates.ts";

const READONLY = "4. Do not create, edit or delete any files.";
const SAVE =
  "4. Then save the answer as a page, usually `topics/<slug>.md`, in the format AGENTS.md describes;\n" +
  "   link it from the pages it draws on, add it to index.md, and append one line to log.md:\n" +
  "   - ${now} | ask | ${question_line} → [[page-name]]";

export interface FilePromptOptions {
  /** Vault-relative screenshots that came with the capture. */
  attachments?: readonly string[];
  /** The owner's standing instructions for this run (a shadow task's body). */
  instructions?: string | null;
}

export function filePrompt(
  captureRel: string,
  captureId: string,
  now: Date,
  { attachments = [], instructions = null }: FilePromptOptions = {},
): string {
  const notes: string[] = [];
  if (attachments.length === 1) {
    notes.push(`This capture has a screenshot: ${attachments[0]}. Open it to see what the owner was looking at.`);
  } else if (attachments.length > 1) {
    notes.push(`This capture has screenshots: ${attachments.join(", ")}. Open them to see what the owner was looking at.`);
  }
  const standing = instructions?.trim();
  if (standing) notes.push(`The owner's standing instructions for this run: ${standing}`);
  return render("prompts/file.md", {
    capture_path: captureRel,
    capture_id: captureId,
    notes: notes.map((paragraph) => `${paragraph}\n\n`).join(""),
    ...times(now),
  });
}

export function askPrompt(question: string, { save, now }: { save: boolean; now: Date }): string {
  let oneLine = question.trim().split(/\s+/).join(" ");
  const chars = Array.from(oneLine);
  if (chars.length > 80) oneLine = `${chars.slice(0, 79).join("").trimEnd()}…`;
  const mode = save ? substitute(SAVE, { question_line: oneLine, ...times(now) }) : READONLY;
  return render("prompts/ask.md", { question: question.trim(), mode, ...times(now) });
}

export function reviewPrompt(reportRel: string, now: Date): string {
  const reportId = (reportRel.split("/").at(-1) ?? reportRel).replace(/\.[^.]*$/, "");
  return render("prompts/review.md", { report_path: reportRel, report_id: reportId, ...times(now) });
}

function times(now: Date): { now: string; today: string } {
  return { now: localMinute(now), today: localDate(now) };
}
