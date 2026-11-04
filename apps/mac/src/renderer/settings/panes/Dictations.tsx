// Settings → Dictations: what was dictated into other apps, newest first, each on a card with the app it went to, when, the words
// (a preview of a long text) and Copy and Delete. The history is the app's own, not the library's, so the pane works with no library
// open and is never behind NoLibrary. It lists the history again when main says it changed (a dictation ended, or one was forgotten
// from the menu). The words are shown here and nowhere else, and are never logged.
import { Actions, Button, Card, Notice, Stack, Text } from "@avanzel/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DELETE_FAILED_BODY } from "../../../main/dictation-rows.ts";
import type { DictationRow } from "../../../shared/ipc.ts";
import {
  DICTATION_NOT_COPIED,
  DICTATION_NOT_COPIED_BODY,
  DICTATION_NOT_DELETED,
  DICTATION_NOT_INSERTED,
  dictationPlace,
  DICTATIONS_EMPTY,
  DICTATIONS_START,
  dictationWhen,
} from "../copy.ts";

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

export function Dictations(): ReactNode {
  // null until the first listing arrives, so the empty line is not shown for the moment before the history is read.
  const [rows, setRows] = useState<DictationRow[] | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listDictations());
    } catch {
      // The list stays as it was; the next change to the history lists it again.
    }
  }, []);
  useEffect(() => {
    void load();
    return api.onDictationsChanged(() => void load());
  }, [load]);
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

  const remove = async (id: string) => {
    let body: string | null;
    try {
      const result = await api.deleteDictation(id);
      body = result.ok ? null : result.message;
    } catch {
      body = DELETE_FAILED_BODY;
    }
    setTold(body === null ? null : { title: DICTATION_NOT_DELETED, body });
    await load();
  };

  if (rows === null) return null;
  if (rows.length === 0) {
    return (
      <Stack gap={4}>
        <Text>{DICTATIONS_EMPTY}</Text>
        <Text variant="footnote" tone="secondary">
          {DICTATIONS_START}
        </Text>
      </Stack>
    );
  }
  const now = new Date();
  return (
    <Stack gap={16}>
      {told && (
        <Notice tone="error" title={told.title}>
          {told.body}
        </Notice>
      )}
      {rows.map((row) => (
        <Dictation key={row.id} row={row} now={now} copied={copied === row.id} onCopy={() => void copy(row.id)} onDelete={() => void remove(row.id)} />
      ))}
    </Stack>
  );
}
