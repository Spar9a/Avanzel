// What setup's and Ask's Notices share of telling a problem (shared/problems.ts): its body, with the part the person types
// in Terminal set as code.
import { Text } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { Problem } from "../../shared/problems.ts";

/**
 * A problem's body for a Notice. A problem that names a `command` has "Run {command}" in its body (the copy's wording): the
 * command is set as code, and the rest is plain. A body without one is its text.
 */
export function problemBody({ body, command }: Problem): ReactNode {
  const at = command === undefined ? -1 : body.indexOf(`Run ${command}`);
  if (command === undefined || at < 0) return body;
  const start = at + "Run ".length;
  return (
    <>
      {body.slice(0, start)}
      <Text variant="code">{command}</Text>
      {body.slice(start + command.length)}
    </>
  );
}
