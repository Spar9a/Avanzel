// Settings → General, in place of Your shelves while a study waits for review: what Avanzel learned of each of the owner's folders, to
// check and change before anything is written. Each folder has File here, what belongs on it and its map; one that is already a shelf of
// the owner's keeps its definition and takes only its map. A folder is left out only when the owner switches it off; one that starts off
// and is never touched is left as it is (`studyApplyOf`). Then the house style the study wrote, beside the one in use (and, when the
// library's AGENTS.md is the owner's own, a line that says the style is kept in Avanzel's settings instead), the folders of
// the owner's that carry a name of Avanzel's own, and Discard (which asks first) and Apply. Apply sends what the owner chose
// (`settings.applyStudy`), as one change Undo takes back; a refusal is told by the window's Notice (`attemptChange`). What the owner
// typed is kept by Settings (`useStudyReview`), not here, so it outlasts the pane and the window.
import { Actions, Button, Confirm, Group, GroupReveal, Notice, Stack, Switch, Text, TextArea } from "@avanzel/ui";
import { useState, type ReactNode } from "react";
import type { ProposedShelf, SettingsSnapshot, StudyProposal } from "../../../shared/ipc.ts";
import {
  APPLY_STUDY,
  CLASH_BODY,
  clashLine,
  CURRENT_STYLE_LABEL,
  definitionLabel,
  DISCARD_STUDY,
  DISCARD_STUDY_QUESTION,
  fileHereLabel,
  HOUSE_STYLE_LABEL,
  LOW_CONFIDENCE,
  mapLabel,
  NOT_STUDIED,
  SAY_WHAT_BELONGS,
  SHELF_DEFINITION_LABEL,
  STUDY_READY_TITLE,
  STUDY_REVIEW_NOTE,
  STYLE_IN_SETTINGS,
} from "../copy.ts";
import { attemptChange, type PaneProps } from "../parts.tsx";
import { draftOf, reviewKey, studyApplyOf, studyReady, type ReviewDraft, type ShelfEdit } from "../study-apply.ts";

const api = window.avanzel.settings;

/** What Settings keeps of the review screen: the draft of the proposal that waits (null while none does), and the Apply or Discard going. */
export interface StudyReviewState {
  draft: ReviewDraft | null;
  change(update: (draft: ReviewDraft) => ReviewDraft): void;
  doing: "apply" | "discard" | null;
  setDoing(doing: "apply" | "discard" | null): void;
}

/**
 * The review screen's draft, kept by Settings so a return to General, or to Settings, finds it as it was. It is kept under the library and
 * the proposal (`reviewKey`): another library, or another study's proposal, starts afresh from what the study proposed (`draftOf`).
 */
export function useStudyReview(snap: SettingsSnapshot | null): StudyReviewState {
  const library = snap?.library?.path ?? null;
  const proposal = snap?.study.kind === "ready" ? snap.study.proposal : null;
  const key = library !== null && proposal ? reviewKey(library, proposal) : null;
  const [kept, setKept] = useState<{ key: string | null; draft: ReviewDraft | null }>({ key: null, draft: null });
  const [doing, setDoing] = useState<"apply" | "discard" | null>(null);
  const draft = kept.key === key ? kept.draft : proposal ? draftOf(proposal) : null;
  if (kept.key !== key) setKept({ key, draft });
  const change = (update: (draft: ReviewDraft) => ReviewDraft) =>
    setKept((now) => (now.key === key && now.draft ? { key, draft: update(now.draft) } : now));
  return { draft, change, doing, setDoing };
}

/** Lines of text kept as lines: a style or a definition shown as read-only words, a paragraph each. */
function Lines({ text }: { text: string }): ReactNode {
  return (
    <Stack gap={2}>
      {text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line, i) => (
          <Text key={i} variant="callout">{line}</Text>
        ))}
    </Stack>
  );
}

/**
 * One proposed folder's group: File here (none on an existing shelf), what belongs on it, its map, and a line when it wasn't studied or
 * Avanzel isn't sure. Each control is named with the folder, as the group's heading doesn't name its rows.
 */
function ShelfGroup({ shelf, edit, onEdit }: { shelf: ProposedShelf; edit: ShelfEdit; onEdit(change: Partial<ShelfEdit>): void }): ReactNode {
  const map = shelf.map !== "" && (
    <div className="settings-editor">
      <TextArea label={mapLabel(shelf.name)} rows={4} value={edit.map} onChange={(next) => onEdit({ map: next })} />
    </div>
  );
  const line = !shelf.studied ? NOT_STUDIED : shelf.confidence === "low" ? LOW_CONFIDENCE : null;
  return (
    <Group label={shelf.name}>
      {shelf.hasDefinition ? (
        <>
          <div className="settings-words">
            <Stack gap={4}>
              <Text variant="footnote" tone="secondary">{SHELF_DEFINITION_LABEL}</Text>
              <Lines text={shelf.definition} />
            </Stack>
          </div>
          {map}
        </>
      ) : (
        <>
          <Switch label={fileHereLabel(shelf.name)} checked={edit.fileHere} onChange={(fileHere) => onEdit({ fileHere, switched: true })} />
          <GroupReveal open={edit.fileHere}>
            <div className="settings-editor">
              <TextArea
                label={definitionLabel(shelf.name)}
                rows={3}
                value={edit.definition}
                description={edit.definition.trim() === "" ? SAY_WHAT_BELONGS : undefined}
                onChange={(definition) => onEdit({ definition })}
              />
            </div>
            {map}
          </GroupReveal>
        </>
      )}
      {line && (
        <div className="settings-words">
          <Text variant="footnote" tone="secondary">{line}</Text>
        </div>
      )}
    </Group>
  );
}

/** The review screen of a study that is ready: `proposal` is `StudyState`'s, and `review` what Settings keeps of it. */
export function StudyReview(props: PaneProps & { proposal: StudyProposal; review: StudyReviewState }): ReactNode {
  const { proposal, review } = props;
  const draft = review.draft ?? draftOf(proposal);
  const { doing } = review;
  // Discard's question, over its button: what the study learned is gone once it is discarded.
  const [asking, setAsking] = useState(false);
  const ready = studyReady(proposal, draft.edits);

  const edit = (i: number, change: Partial<ShelfEdit>) =>
    review.change((now) => ({ ...now, edits: now.edits.map((one, at) => (at === i ? { ...one, ...change } : one)) }));
  const run = async (what: "apply" | "discard") => {
    if (doing) return;
    review.setDoing(what);
    try {
      await attemptChange(props, () => (what === "apply" ? api.applyStudy(studyApplyOf(proposal, draft)) : api.discardStudy()));
    } finally {
      review.setDoing(null);
    }
  };

  return (
    <Stack gap={20}>
      <div className="settings-intro">
        <Stack gap={4}>
          <Text variant="headline">{STUDY_READY_TITLE}</Text>
          <Text variant="footnote" tone="secondary">{STUDY_REVIEW_NOTE}</Text>
        </Stack>
      </div>
      {proposal.shelves.map((shelf, i) => (
        <ShelfGroup key={shelf.folder} shelf={shelf} edit={draft.edits[i] ?? draftOf(proposal).edits[i]!} onEdit={(change) => edit(i, change)} />
      ))}
      <Group label={HOUSE_STYLE_LABEL}>
        <div className="settings-editor">
          <TextArea label={HOUSE_STYLE_LABEL} labelHidden rows={6} value={draft.style} onChange={(style) => review.change((now) => ({ ...now, style }))} />
        </div>
        {proposal.currentStyle.trim() !== "" && (
          <div className="settings-words">
            <Stack gap={4}>
              <Text variant="footnote" tone="secondary">{CURRENT_STYLE_LABEL}</Text>
              <Lines text={proposal.currentStyle} />
            </Stack>
          </div>
        )}
        {!proposal.styleInAgents && (
          <div className="settings-words">
            <Text variant="footnote" tone="secondary">{STYLE_IN_SETTINGS}</Text>
          </div>
        )}
      </Group>
      {proposal.clashes.map((folder) => (
        <Notice key={folder} title={clashLine(folder)}>
          {CLASH_BODY}
        </Notice>
      ))}
      <div className="settings-intro">
        <Actions>
          <Confirm
            open={asking}
            question={DISCARD_STUDY_QUESTION}
            confirmLabel={DISCARD_STUDY}
            onConfirm={() => {
              setAsking(false);
              void run("discard");
            }}
            onCancel={() => setAsking(false)}
          >
            <Button variant="danger" expanded={asking} busy={doing === "discard"} disabled={doing === "apply"} onClick={() => setAsking(!asking)}>
              {DISCARD_STUDY}
            </Button>
          </Confirm>
          <Button variant="primary" busy={doing === "apply"} disabled={!ready || doing === "discard"} onClick={() => void run("apply")}>{APPLY_STUDY}</Button>
        </Actions>
      </div>
    </Stack>
  );
}
