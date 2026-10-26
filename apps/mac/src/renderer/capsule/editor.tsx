// The capsule while the person edits the words before they are filed: a card and no bar.
import { Actions, Button, Card, TextArea } from "@avanzel/ui";
import { useState } from "react";
import { api } from "./api.ts";

/**
 * The words are edited on the card's paper (owner item 13), in a field. The field is where they are written, so the card has no
 * ruling: its lines would show through the field and drift across the words. The panel takes the focus for this, and Return files,
 * Shift-Return starts a line and Esc gives the edit up. Every change goes to main, which keeps the edit if Avanzel quits or a
 * recording starts first. Cancel and File are the card's own.
 */
export function Editor({ text }: { text: string }) {
  const [value, setValue] = useState(text);
  return (
    <div className="stack">
      <Card
        label="Edit before filing"
        ruled={false}
        footer={
          <Actions>
            <Button size="small" variant="quiet" onClick={() => api.cancelEdit()}>Cancel</Button>
            <Button size="small" variant="primary" onClick={() => api.submitEdit(value)}>File</Button>
          </Actions>
        }
      >
        <div className="editor">
          <TextArea
            label="Your words"
            labelHidden
            autoFocus
            value={value}
            onChange={(next) => {
              setValue(next);
              api.editDraft(next);
            }}
            onEnter={() => api.submitEdit(value)}
            onEscape={() => api.cancelEdit()}
          />
        </div>
      </Card>
    </div>
  );
}
