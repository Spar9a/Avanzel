// Settings → General, in place of Your shelves while a study waits for review: what Avanzel learned of each of the owner's folders, to
// check and change before anything is written. Each folder has File here, what belongs on it and its map; one that is already a shelf of
// the owner's keeps its definition and takes only its map. Then the house style the study wrote, beside the one in use, the folders of
// the owner's that carry a name of Avanzel's own, and Discard and Apply. Apply sends what the owner chose (`settings.applyStudy`), as one
// change Undo takes back; a refusal is told by the window's Notice (`attemptChange`).
import { Actions, Button, Group, GroupReveal, Stack, Switch, Text, TextArea } from "@avanzel/ui";
import { useState, type ReactNode } from "react";
import type { ProposedShelf, StudyApply, StudyProposal } from "../../../shared/ipc.ts";
import {
  APPLY_STUDY,
  clashLine,
  CURRENT_STYLE_LABEL,
  DISCARD_STUDY,
  FILE_HERE,
  HOUSE_STYLE_LABEL,
  LOW_CONFIDENCE,
  NOT_STUDIED,
  SAY_WHAT_BELONGS,
  SHELF_DEFINITION_LABEL,
  STUDY_MAP_LABEL,
  STUDY_READY_TITLE,
  STUDY_REVIEW_NOTE,
} from "../copy.ts";
import { attemptChange, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** What the owner made of one proposed folder: whether to file into it, and its definition and map as they stand in the fields. */
interface ShelfEdit {
  fileHere: boolean;
  definition: string;
  map: string;
}

/**
 * A folder starts turned on when it has something to say what belongs on it: an unstudied folder with no definition starts off, so
 * Apply isn't held back by a field the owner never asked for.
 */
const editOf = (shelf: ProposedShelf): ShelfEdit => ({
  fileHere: shelf.hasDefinition || shelf.definition.trim() !== "",
  definition: shelf.definition,
  map: shelf.map,
});

/** The folders one by one: a folder that is already the owner's shelf is always filed into, and keeps its definition. */
export function studyApplyOf(proposal: StudyProposal, edits: readonly ShelfEdit[], style: string): StudyApply {
  return {
    shelves: proposal.shelves.map((shelf, i) => {
      const edit = edits[i] ?? editOf(shelf);
      return {
        folder: shelf.folder,
        name: shelf.name,
        definition: shelf.hasDefinition ? shelf.definition : edit.definition.trim(),
        map: edit.map.trim(),
        fileHere: shelf.hasDefinition || edit.fileHere,
      };
    }),
    style: style.trim(),
  };
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

/** One proposed folder's group: File here (none on an existing shelf), what belongs on it, its map, and a line when it wasn't studied or Avanzel isn't sure. */
function ShelfGroup({ shelf, edit, onEdit }: { shelf: ProposedShelf; edit: ShelfEdit; onEdit(change: Partial<ShelfEdit>): void }): ReactNode {
  const map = shelf.map !== "" && (
    <div className="settings-editor">
      <TextArea label={STUDY_MAP_LABEL} rows={4} value={edit.map} onChange={(next) => onEdit({ map: next })} />
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
          <Switch label={FILE_HERE} checked={edit.fileHere} onChange={(fileHere) => onEdit({ fileHere })} />
          <GroupReveal open={edit.fileHere}>
            <div className="settings-editor">
              <TextArea
                label={SHELF_DEFINITION_LABEL}
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

/** The review screen of a study that is ready: `proposal` is `StudyState`'s. */
export function StudyReview(props: PaneProps & { proposal: StudyProposal }): ReactNode {
  const { proposal } = props;
  const [edits, setEdits] = useState<ShelfEdit[]>(() => proposal.shelves.map(editOf));
  const [style, setStyle] = useState(proposal.style);
  const [doing, setDoing] = useState<"apply" | "discard" | null>(null);
  // A folder turned on needs what belongs on it, unless it is already a shelf with one.
  const ready = proposal.shelves.every((shelf, i) => shelf.hasDefinition || !edits[i]?.fileHere || edits[i].definition.trim() !== "");

  const edit = (i: number, change: Partial<ShelfEdit>) => setEdits((now) => now.map((one, at) => (at === i ? { ...one, ...change } : one)));
  const run = async (what: "apply" | "discard") => {
    if (doing) return;
    setDoing(what);
    try {
      await attemptChange(props, () => (what === "apply" ? api.applyStudy(studyApplyOf(proposal, edits, style)) : api.discardStudy()));
    } finally {
      setDoing(null);
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
        <ShelfGroup key={shelf.folder} shelf={shelf} edit={edits[i] ?? editOf(shelf)} onEdit={(change) => edit(i, change)} />
      ))}
      <Group label={HOUSE_STYLE_LABEL}>
        <div className="settings-editor">
          <TextArea label={HOUSE_STYLE_LABEL} labelHidden rows={6} value={style} onChange={setStyle} />
        </div>
        {proposal.currentStyle.trim() !== "" && (
          <div className="settings-words">
            <Stack gap={4}>
              <Text variant="footnote" tone="secondary">{CURRENT_STYLE_LABEL}</Text>
              <Lines text={proposal.currentStyle} />
            </Stack>
          </div>
        )}
      </Group>
      {proposal.clashes.length > 0 && (
        <div className="settings-intro">
          <Stack gap={4}>
            {proposal.clashes.map((folder) => (
              <Text key={folder} variant="footnote" tone="secondary">{clashLine(folder)}</Text>
            ))}
          </Stack>
        </div>
      )}
      <div className="settings-intro">
        <Actions>
          <Button variant="secondary" busy={doing === "discard"} disabled={doing === "apply"} onClick={() => void run("discard")}>{DISCARD_STUDY}</Button>
          <Button variant="primary" busy={doing === "apply"} disabled={!ready || doing === "discard"} onClick={() => void run("apply")}>{APPLY_STUDY}</Button>
        </Actions>
      </div>
    </Stack>
  );
}
