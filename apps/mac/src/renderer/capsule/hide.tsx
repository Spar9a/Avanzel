// Hide, the first button of the bar of every capsule card that is not a problem.
import { Button } from "@avanzel/ui";
import { api } from "./api.ts";

/** A quiet icon that puts the card away. Whatever work the card was about goes on: a filing ends in its notification. */
export function Hide() {
  return <Button variant="quiet" size="small" icon="close" label="Hide" onClick={() => api.dismiss()} />;
}
