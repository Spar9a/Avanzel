// Settings → Dictation: dictating into any app and what it has done. The switch, its key, whether the library keeps a day file, and a line with
// its fix while macOS lacks a permission (Privacy lists them all). Then what was dictated, newest first, each on a card with the app it
// went to, when, the words (a preview of a long text) and Copy and Delete: words that are kept go on paper. The history is the app's own,
// not the library's, so the pane works with no library open and is never behind NoLibrary. The window keeps the listing, which follows main when it
// says the history changed (a dictation ended, or one was forgotten from the menu). Once a dictation has ended its words are shown here and in the
// menu's Recent dictations, and they are never logged.
import { Actions, Button, Card, Group, GroupRow, Notice, Stack, Switch, Text } from "@avanzel/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DICTATION_PAGE, type CursorKey, type DictationRow } from "../../../shared/ipc.ts";
import {
  CURSOR_DICTATION_DESCRIPTION,
  CURSOR_KEY_DESCRIPTION,
  cursorKeyName,
  cursorKeyOptions,
  cursorStatus,
  DELETE_FAILED_BODY,
  DICTATION_LOG_LABEL,
  dictationLogLine,
  DICTATION_NOT_COPIED,
  DICTATION_NOT_COPIED_BODY,
  DICTATION_NOT_DELETED,
  DICTATION_NOT_INSERTED,
  dictationPlace,
  DICTATIONS_EMPTY,
  DICTATIONS_RECENT,
  dictationsStart,
  dictationWhen,
  olderDictationsLine,
  SHOW_MORE_DICTATIONS,
} from "../copy.ts";
import { useCursorPermissions } from "../cursor-permissions.ts";
import { attemptChange, PickButton, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** How long Copy says "Copied" before it is Copy again, in ms. */
const COPIED_MS = 2500;

/** What the Notice above the cards tells: a Copy or a Delete that didn't work. */
interface Told {
  title: string;
  body: string;
}

interface RowProps {
  row: DictationRow;
  now: Date;
  copied: boolean;
  onCopy(): void;
  onDelete(): void;
}

/** One dictation: its card, with the app as the label and the time as the meta line, and under the words, the window or site, a note if the words didn't go in, and the buttons. */
function Dictation({ row, now, copied, onCopy, onDelete }: RowProps): ReactNode {
  const place = dictationPlace(row);
  const when = dictationWhen(row.at, now);
  return (
    <div role="group" aria-label={[place.app, when].filter(Boolean).join(", ")}>
      <Card
        label={place.app}
        meta={when || undefined}
        footer={
          <Stack gap={8}>
            {place.detail && (
              <Text variant="footnote" tone="secondary">
                {place.detail}
              </Text>
            )}
            {!row.inserted && <Text variant="footnote">{DICTATION_NOT_INSERTED}</Text>}
            <Actions align="start">
              <Button size="small" variant="secondary" onClick={onCopy}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="small" variant="danger" onClick={onDelete}>
                Delete
              </Button>
            </Actions>
          </Stack>
        }
      >
        {row.preview}
      </Card>
    </div>
  );
}

/**
 * The switch, the key, and a line on what macOS still has to grant, with the button that asks for it. The line shows while the switch is off
 * too, so the person can grant before turning it on; turning it on with a permission missing still turns it on, and the line says what to
 * do. A Mac without the helper gets one line and controls that are off. With a library open, whether it keeps a day file follows, which
 * applies at once.
 */
function DictationGroup(props: PaneProps): ReactNode {
  const { enabled, key } = props.snap.app.cursorDictation;
  const library = props.snap.library?.exists ? props.snap.library : null;
  const { state, ask } = useCursorPermissions(enabled);
  const status = state && cursorStatus(state);
  const off = state !== null && !state.available;
  return (
    <Group>
      <Switch
        label="Dictate into any app"
        description={CURSOR_DICTATION_DESCRIPTION}
        checked={enabled}
        disabled={off}
        onChange={(on) => attemptChange(props, () => api.setCursorDictation({ enabled: on }))}
      />
      <GroupRow label="Key" description={CURSOR_KEY_DESCRIPTION}>
        <PickButton
          label="Dictation key"
          value={cursorKeyName(key)}
          options={cursorKeyOptions(key)}
          disabled={off}
          onChoose={(value) => attemptChange(props, () => api.setCursorDictation({ key: value as CursorKey }))}
        />
      </GroupRow>
      {/* All granted, there is nothing to say here: Privacy lists the permissions. */}
      {status && (status.fix || off) && (
        <GroupRow label={status.line}>
          {status.fix && (
            <Button size="small" variant="secondary" onClick={() => void ask()}>
              {status.fix}
            </Button>
          )}
        </GroupRow>
      )}
      {library && (
        <Switch
          label={DICTATION_LOG_LABEL}
          description={dictationLogLine(library.dictationLog)}
          checked={library.dictationLog}
          onChange={(on) => attemptChange(props, () => api.setLibrary({ dictationLog: on }))}
        />
      )}
    </Group>
  );
}

/** What the history holds, as the Settings window keeps it. */
export interface DictationListing {
  /** Null until the first listing arrives, so the empty line is not shown for the moment before the history is read. */
  rows: DictationRow[] | null;
  /** How many the history holds in all: `rows` are the newest of them, and `more` asks for another page. */
  total: number;
  more(): void;
  load(): Promise<void>;
}

/**
 * The history, for the Settings window to keep, as it keeps the reviews' edits and the fields' drafts. It is listed as the window opens, and not as the
 * pane does, so that the pane has its whole height the moment it shows and the window moves once for it. It is listed again when main says it changed.
 */
export function useDictationListing(): DictationListing {
  const [rows, setRows] = useState<DictationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(DICTATION_PAGE);
  // Asking again after a change keeps the limit, so a list the person lengthened is not cut back under them.
  const load = useCallback(async () => {
    try {
      const list = await api.listDictations(limit);
      setRows(list.rows);
      setTotal(list.total);
    } catch {
      // The list stays as it was; the next change to the history lists it again.
    }
  }, [limit]);
  useEffect(() => {
    void load();
    return api.onDictationsChanged(() => void load());
  }, [load]);
  return { rows, total, more: () => setLimit(limit + DICTATION_PAGE), load };
}

export function Dictations({ listing, ...props }: PaneProps & { listing: DictationListing }): ReactNode {
  return (
    <Stack gap={20}>
      <DictationGroup {...props} />
      <History enabled={props.snap.app.cursorDictation.enabled} listing={listing} />
    </Stack>
  );
}

/** What was dictated, newest first. With nothing yet, it says how to start: `enabled` is whether the switch above it is on. */
function History({ enabled, listing }: { enabled: boolean; listing: DictationListing }): ReactNode {
  const { rows, total, more, load } = listing;
  const [told, setTold] = useState<Told | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Asked again as the pane shows, in case the listing the window made didn't arrive: it draws what it has meanwhile.
  useEffect(() => void load(), []);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (id: string) => {
    let done = false;
    try {
      done = await api.copyDictation(id);
    } catch {
      done = false;
    }
    if (done) {
      setTold(null);
      setCopied(id);
    } else {
      setCopied(null);
      setTold({ title: DICTATION_NOT_COPIED, body: DICTATION_NOT_COPIED_BODY });
    }
  };

  // A failure brings its own title when the pane's would be wrong: words that left the history but may still be in the library.
  const remove = async (id: string) => {
    let told: Told | null;
    try {
      const result = await api.deleteDictation(id);
      told = result.ok ? null : { title: result.title ?? DICTATION_NOT_DELETED, body: result.message };
    } catch {
      told = { title: DICTATION_NOT_DELETED, body: DELETE_FAILED_BODY };
    }
    setTold(told);
    await load();
  };

  if (rows === null) return null;
  // Deleting the last dictation can leave something to tell: its words may still be in the library's day file.
  const notice = told && (
    <Notice tone="error" title={told.title}>
      {told.body}
    </Notice>
  );
  if (total === 0) {
    return (
      <Stack gap={16}>
        {notice}
        <Stack gap={4}>
          <Text>{DICTATIONS_EMPTY}</Text>
          <Text variant="footnote" tone="secondary">
            {dictationsStart(enabled)}
          </Text>
        </Stack>
      </Stack>
    );
  }
  const now = new Date();
  return (
    <Stack gap={16}>
      <Text variant="footnote" tone="secondary" as="h3">
        {DICTATIONS_RECENT}
      </Text>
      {notice}
      {rows.map((row) => (
        <Dictation key={row.id} row={row} now={now} copied={copied === row.id} onCopy={() => void copy(row.id)} onDelete={() => void remove(row.id)} />
      ))}
      {total > rows.length && (
        <Stack gap={8}>
          <Text variant="footnote" tone="secondary">
            {olderDictationsLine(total - rows.length)}
          </Text>
          <Actions align="start">
            <Button size="small" variant="secondary" onClick={more}>
              {SHOW_MORE_DICTATIONS}
            </Button>
          </Actions>
        </Stack>
      )}
    </Stack>
  );
}
