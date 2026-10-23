// Settings → Voice: the microphone Avanzel listens with. The pane's other groups (shortcuts and the speech model) are
// still in main.tsx until their own task moves them here.
import { Group, GroupRow } from "@avanzel/ui";
import { useEffect, useState, type ReactNode } from "react";
import { microphoneName, microphoneOptions, type InputDevice } from "../copy.ts";
import { ChooseButton, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** Voice's "Microphone" group: the device in use, and Choose…. A choice applies at once. */
export function MicrophoneGroup({ snap, onChange }: PaneProps): ReactNode {
  // The audio inputs this Mac lists, once the page has asked. The "default" entry stands for whatever macOS uses, which
  // System default already is, so it isn't a device of its own.
  const [devices, setDevices] = useState<InputDevice[]>([]);
  useEffect(() => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((device) => device.kind === "audioinput" && device.deviceId !== "default")));
  }, []);
  const id = snap.app.microphoneId;
  return (
    <Group label="Microphone">
      <GroupRow label={microphoneName(id, devices)} description="Avanzel listens only while the capsule shows it listening.">
        <ChooseButton
          label="Microphone"
          options={microphoneOptions(id, devices)}
          onChoose={async (value) => onChange(await api.setApp({ microphoneId: value || null }))}
        />
      </GroupRow>
    </Group>
  );
}
