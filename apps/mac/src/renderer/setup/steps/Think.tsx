// Step 3, What's on your mind this week?: the first thought. For now, its heading and Back.
import { Button, Text } from "@avanzel/ui";
import { Frame, type StepProps } from "../frame.tsx";

export function Think({ snap, go }: StepProps) {
  return (
    <Frame model={snap.model} stage={null} actions={<Button variant="quiet" onClick={() => go("found")}>Back</Button>}>
      <Text variant="heading">What's on your mind this week?</Text>
    </Frame>
  );
}
