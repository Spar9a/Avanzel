// Settings → Dictation: dictating into any app and what it has done. The switch, its key, whether the library keeps a day file, and a line with
// its fix while macOS lacks a permission (Privacy lists them all). Then what was dictated, newest first, each on a card with the app it
// went to, when, the words (a preview of a long text) and Copy and Delete: words that are kept go on paper. The history is the app's own,
// not the library's, so the pane works with no library open and is never behind NoLibrary. The window keeps the listing, which follows main when it
// says the history changed (a dictation ended, or one was forgotten from the menu). Once a dictation has ended its words are shown here and in the
// menu's Recent dictations, and they are never logged.
import { Actions, Button, Card, Group, GroupRow, Notice, ShortcutField, Stack, Switch, Text } from "@avanzel/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { prettyAccelerator } from "../../../main/shortcuts.ts";
import { DICTATION_PAGE, type CursorKey, type DictationKey, type DictationRow } from "../../../shared/ipc.ts";
import {
  CHANGE_SHORTCUT,
  CURSOR_KEY_DESCRIPTION,
  CURSOR_SHORTCUT_SAFE,
  DICTATION_BLOCKED_SAFE,
  CURSOR_SHORTCUT_DESCRIPTION,
  CURSOR_SHORTCUT_LABEL,
  CURSOR_SHORTCUT_NONE,
  cursorDictationDescription,
  cursorKeyOptions,
  cursorStatus,
  DICTATION_BLOCKED,
  dictationKeyName,
  shortcutRefusedLine,
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
import { useShortcutRecorder } from "../shortcut-recorder.ts";

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

/** What a screen reader is told of a shortcut recording given up. */
const NOT_CHANGED = "Not changed";

/**
 * The switch, the key (one of four to tap, or a shortcut of the person's own, whose field then follows), and what macOS still has to grant.
 * While the switch is off, that is a line with the button that asks, so the person can grant before turning it on. While it is on, a
 * permission missing means dictating can't work, so it is an error Notice under the group, whose one fix asks macOS or opens System
 * Settings at the first one missing. A shortcut that doesn't work (another app's, or an action's) gets a Notice of its own. A Mac without
 * the helper gets one line and controls that are off. With a library open, whether it keeps a day file follows, which applies at once.
 */
function DictationGroup(props: PaneProps): ReactNode {
  const { enabled, key, shortcut } = props.snap.app.cursorDictation;
  const library = props.snap.library?.exists ? props.snap.library : null;
  const { state, ask } = useCursorPermissions(enabled);
  const status = state && cursorStatus(state, key);
  const off = state !== null && !state.available;
  // Custom shortcut… with none saved yet records one first: the key changes once it is typed, and Esc leaves the key as it was.
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | null>(null);
  const custom = key === "custom" || recording;
  // On, and macOS lacks something it needs: dictating can't work, which the pane's red Notice says.
  const blocked = enabled && !off && status?.fix ? { line: status.line, fix: status.fix } : null;
  const shortcutProblem = enabled && key === "custom" ? props.snap.cursorShortcutProblem : null;

  const saveShortcut = async (accelerator: string) => {
    const next = await props.attempt(() => api.setCursorDictation({ key: "custom", shortcut: accelerator }));
    if (!next) return;
    props.onChange(next);
    if (!next.cursorShortcutProblem) setSaved(`Saved ${prettyAccelerator(accelerator)}`);
    field.current?.querySelector("button")?.focus();
  };
  // A recording given up before any shortcut was saved takes its field away, and the focus with it: the focus goes back to the key's menu,
  // where the recording began, which a screen reader then names with the key that is still chosen.
  const keyBox = useRef<HTMLDivElement | null>(null);
  const giveUp = () => {
    setRecording(false);
    setSaved(NOT_CHANGED);
    if (key !== "custom") requestAnimationFrame(() => keyBox.current?.querySelector("button")?.focus());
  };
  useShortcutRecorder(recording, {
    onShortcut: (accelerator) => {
      setRecording(false);
      void saveShortcut(accelerator);
    },
    onCancel: giveUp,
    onRefused: setRefused,
    onStop: () => setRecording(false),
  });
  useLayoutEffect(() => setRefused(null), [recording]);
  // The field the shortcut is typed into: a recording started from the key's menu puts the focus on it, so the keys go to it and a screen
  // reader hears that it records. Back on the field after a save, too.
  const field = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (recording) field.current?.querySelector("button")?.focus();
  }, [recording]);

  const record = () => {
    setSaved(undefined);
    setRecording(true);
  };
  const choose = (value: string) => {
    if (value === "custom") {
      if (shortcut) return void attemptChange(props, () => api.setCursorDictation({ key: "custom" }));
      return record();
    }
    setRecording(false);
    attemptChange(props, () => api.setCursorDictation({ key: value as CursorKey }));
  };

  return (
    <>
      <Group>
        <Switch
          label="Dictate into any app"
          description={cursorDictationDescription(custom ? "custom" : key)}
          checked={enabled}
          disabled={off}
          onChange={(on) => attemptChange(props, () => api.setCursorDictation({ enabled: on }))}
        />
        <GroupRow label="Key" description={custom ? undefined : CURSOR_KEY_DESCRIPTION}>
          <div ref={keyBox}>
            <PickButton
              label="Dictation key"
              value={dictationKeyName(custom ? "custom" : key)}
              options={cursorKeyOptions(custom ? "custom" : key)}
              disabled={off}
              onChoose={choose}
            />
          </div>
        </GroupRow>
        {custom && (
          <GroupRow
            label={CURSOR_SHORTCUT_LABEL}
            description={recording && refused ? shortcutRefusedLine(refused) : CURSOR_SHORTCUT_DESCRIPTION}
            live={recording && refused !== null}
          >
            <div
              ref={field}
              onBlur={(event) => {
                // The focus went to another control, or to nothing: the recording is over.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRecording(false);
              }}
            >
              <ShortcutField
                label="Dictation shortcut"
                value={shortcut ? prettyAccelerator(shortcut) : CURSOR_SHORTCUT_NONE}
                recording={recording}
                saved={saved}
                onClick={() => (recording ? giveUp() : record())}
              />
            </div>
          </GroupRow>
        )}
        {/* While it is off, a line; while it is on, the Notice below says it. All granted, there is nothing to say: Privacy lists them. */}
        {status && (off || (!enabled && status.fix)) && (
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
      {blocked && (
        <Notice
          tone="error"
          title={DICTATION_BLOCKED}
          actions={
            <Actions align="start">
              <Button size="small" variant="primary" onClick={() => void ask()}>
                {blocked.fix}
              </Button>
            </Actions>
          }
        >
          {`${blocked.line} ${DICTATION_BLOCKED_SAFE}`}
        </Notice>
      )}
      {/* Its fix records another shortcut; the pane's one primary is the permissions' while they are missing. */}
      {shortcutProblem && (
        <Notice
          tone="error"
          title={shortcutProblem}
          actions={
            <Actions align="start">
              <Button size="small" variant={blocked ? "secondary" : "primary"} onClick={record}>
                {CHANGE_SHORTCUT}
              </Button>
            </Actions>
          }
        >
          {CURSOR_SHORTCUT_SAFE}
        </Notice>
      )}
    </>
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
      <History enabled={props.snap.app.cursorDictation.enabled} dictationKey={props.snap.app.cursorDictation.key} listing={listing} />
    </Stack>
  );
}

/**
 * What was dictated, newest first. With nothing yet, it says how to start: `enabled` is whether the switch above it is on, and `dictationKey`
 * whether a key is tapped or a shortcut pressed.
 */
function History({ enabled, dictationKey, listing }: { enabled: boolean; dictationKey: DictationKey; listing: DictationListing }): ReactNode {
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
            {dictationsStart(enabled, dictationKey)}
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
