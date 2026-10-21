// What every setup step stands in: a strip to drag the window by, the stage on the left beside the step on the right,
// and a footer with the speech model's download on the left and the step's buttons on the right.
import { Actions, Button, Progress, Row, Stage, Text } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { ModelStatus, SetupSnapshot, SetupStep } from "../../shared/ipc.ts";
import { megabytes } from "./copy.ts";

/** What each step is given: the snapshot, and the way to another step. */
export interface StepProps {
  snap: SetupSnapshot;
  go(step: SetupStep): void;
}

/**
 * Brings `el` into the middle of the step when any of it is out of view: the step (Frame's <main>) scrolls when it
 * holds more than fits, say four agents, a folder with files and a problem, and what needs the person mustn't be cut
 * off at its edge.
 */
export function reveal(el: Element | null): void {
  const view = el?.closest("main")?.getBoundingClientRect();
  const box = el?.getBoundingClientRect();
  if (el && view && box && (box.top < view.top || box.bottom > view.bottom)) el.scrollIntoView({ block: "center" });
}

export function Frame({ stage, children, actions, model }: { stage: ReactNode; children: ReactNode; actions?: ReactNode; model: ModelStatus }) {
  return (
    <div className="frame">
      <div className="drag" />
      <div className="stage">
        <Stage>{stage}</Stage>
      </div>
      <main className="step">{children}</main>
      <footer className="footer">
        <div className="download">
          <Download model={model} />
        </div>
        {actions && <Actions>{actions}</Actions>}
      </footer>
    </div>
  );
}

/** The speech model in the footer: its size until it downloads, the download, or a failed one with its way out. Ready: nothing. */
export function Download({ model }: { model: ModelStatus }) {
  if (model.kind === "missing" && model.bytes > 0) {
    return <Text variant="footnote" tone="secondary">{`Speech model, ${megabytes(model.bytes)} MB. Downloads when you continue.`}</Text>;
  }
  if (model.kind === "downloading") {
    const known = model.totalBytes > 0;
    return (
      <Row gap={10}>
        <Text variant="footnote" as="span">Getting my ears ready</Text>
        <div className="meter">
          <Progress label="Downloading the speech model" value={known ? model.receivedBytes / model.totalBytes : undefined} />
        </div>
        {known && <Text variant="footnote" tone="secondary" as="span" numeric>{`${megabytes(model.receivedBytes)} of ${megabytes(model.totalBytes)} MB`}</Text>}
      </Row>
    );
  }
  if (model.kind === "error" && model.cause === "download") {
    return (
      <Row gap={10}>
        <Text variant="footnote" as="span">The speech model didn't finish downloading.</Text>
        <Button size="small" onClick={() => void window.avanzel.settings.downloadModel()}>Try the download again</Button>
      </Row>
    );
  }
  return null;
}
