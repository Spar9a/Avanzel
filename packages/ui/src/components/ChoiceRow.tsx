import { Children, type ReactNode, type Ref } from "react";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";
import { GroupRow } from "./Group.tsx";
import { Icon } from "./Icon.tsx";
import { Row } from "./Layout.tsx";
import "../foundations.css";
import "./choicerow.css";

export interface ChoiceRowProps {
  /** What is chosen between: the agent's name. */
  label: string;
  /** Under the label: a line about the row, or its status, which may hold a command. */
  description?: ReactNode;
  /** A screen reader is told when `description` changes (see GroupRow). */
  live?: boolean;
  /** A recommendation, such as "Best results". */
  badge?: string;
  /** This row is the one in use: it shows a check, named "Chosen", where the others offer to be used. */
  chosen: boolean;
  /** The row can't be chosen (the agent isn't installed): it has no button. */
  unavailable?: boolean;
  /** The button's label on a row that isn't chosen: "Use Codex", or "Use" where the row's group says whose it is. */
  chooseLabel: string;
  onChoose: () => void;
  /** The check, for code that brings the chosen row into view. */
  chosenRef?: Ref<HTMLSpanElement>;
  /** Other controls on the row, after the choice: Copy install command. */
  children?: ReactNode;
}

/**
 * One row of a list in which exactly one row is chosen, inside a `Group`: its badge, a check where it is the one chosen or a
 * button that chooses it, then the row's other controls. The controls are one group named for the row, so VoiceOver says
 * whose button each one is. A row with nothing to choose or press has no group.
 */
export function ChoiceRow({ label, description, live, badge, chosen, unavailable, chooseLabel, onChoose, chosenRef, children }: ChoiceRowProps) {
  const empty = !badge && !chosen && unavailable && Children.toArray(children).length === 0;
  return (
    <GroupRow label={label} description={description} live={live}>
      {!empty && (
        <div role="group" aria-label={label}>
          <Row gap={8}>
            {badge && <Badge>{badge}</Badge>}
            {chosen ? (
              <span ref={chosenRef} className="av-choice-chosen"><Icon name="check" label="Chosen" /></span>
            ) : (
              !unavailable && <Button size="small" variant="secondary" onClick={onChoose}>{chooseLabel}</Button>
            )}
            {children}
          </Row>
        </div>
      )}
    </GroupRow>
  );
}
