// Step 2, Here's what I found: the library's place and the agent that files. For now, its heading and Back.
import { Button, Text } from "@avanzel/ui";
import { Frame, type StepProps } from "../frame.tsx";

export function Found({ snap, go }: StepProps) {
  return (
    <Frame model={snap.model} stage={null} actions={<Button variant="quiet" onClick={() => go("hello")}>Back</Button>}>
      <Text variant="heading">Here's what I found.</Text>
    </Frame>
  );
}
