// Wires the preload bridge's channels to the controller.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { AppSettings, SetupStep, Shortcuts, TaskInfo } from "../shared/ipc.ts";
import type { Controller } from "./controller.ts";

type Handler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;

export function registerIpc(controller: Controller): void {
  const handle = (channel: string, fn: Handler) => ipcMain.handle(channel, fn as Parameters<typeof ipcMain.handle>[1]);
  const on = (channel: string, fn: (event: IpcMainEvent, ...args: never[]) => void) =>
    ipcMain.on(channel, fn as Parameters<typeof ipcMain.on>[1]);

  // capsule
  on("capsule:ready", () => controller.capsuleReady());
  handle("capsule:audio", (_e, samples: Float32Array) => controller.onAudio(samples));
  on("capsule:mic-error", (_e, message: string) => controller.micError(message));
  on("capsule:interactive", (_e, interactive: boolean) => controller.setInteractive(interactive));
  on("capsule:edit", () => controller.edit());
  on("capsule:edit-draft", (_e, text: string) => controller.editDraft(text));
  on("capsule:submit-edit", (_e, text: string) => controller.submitEdit(text));
  on("capsule:cancel-edit", () => controller.cancelEdit());
  on("capsule:undo", () => void controller.undo());
  on("capsule:open", () => controller.openFiled());
  on("capsule:dismiss", () => controller.dismiss());
  on("capsule:keep-open", (_e, keep: boolean) => controller.setKeepOpen(keep));
  on("capsule:open-settings-for", (_e, action: string) => controller.openSettingsFor(action));
  on("capsule:retry-download", () => controller.retryDownload());
  on("capsule:type-instead", () => controller.typeInstead());
  on("capsule:use-shortcut", (_e, key: keyof Shortcuts, accelerator: string) => void controller.useShortcut(key, accelerator));

  // settings
  handle("settings:get", () => controller.snapshot());
  handle("settings:set-app", (_e, patch: Partial<AppSettings>) => controller.setApp(patch));
  handle("settings:set-library", (_e, patch: { harness?: string; models?: Record<string, string>; timeoutSeconds?: number }) =>
    controller.setLibrarySettings(patch));
  handle("settings:choose-library", () => controller.chooseLibrary());
  handle("settings:create-library", (_e, target: string) => controller.createLibrary(target));
  handle("settings:download-model", () => controller.downloadModel());
  handle("settings:save-task", (_e, task: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">) =>
    controller.saveTaskFromSettings(task));
  handle("settings:run-task", (_e, id: string) => controller.runTask(id));
  handle("settings:check-agents", () => controller.checkAgents());
  handle("settings:check-agent", (_e, name: string) => controller.checkAgent(name));
  handle("settings:request-permission", (_e, kind: "microphone" | "screen") => controller.requestPermission(kind));
  on("settings:open-library", () => controller.openLibraryFolder());
  on("settings:open-privacy", (_e, pane: "microphone" | "screen") => void controller.openPrivacy(pane));

  // quick type & ask
  handle("quick:submit", (_e, text: string) => controller.submitQuick(text));
  on("quick:close", () => controller.closeQuick());
  handle("ask:ask", (_e, question: string) => controller.ask(question));
  on("ask:open-page", (_e, name: string) => controller.openPageByName(name));
  on("ask:close", () => controller.closeAsk());

  // setup
  handle("setup:get", () => controller.setupSnapshot());
  handle("setup:enter", (_e, step: SetupStep) => controller.enterSetupStep(step));
  handle("setup:choose-agent", (_e, name: string) => controller.chooseSetupAgent(name));
  handle("setup:create-library", () => controller.createSetupLibrary());
  handle("setup:choose-folder", () => controller.chooseSetupFolder());
  handle("setup:use-shortcut", (_e, accelerator: string) => controller.useSetupShortcut(accelerator));
  handle("setup:type-thought", (_e, words: string) => controller.typeSetupThought(words));
  on("setup:open-terminal", () => controller.openTerminal());
  on("setup:copy", (_e, text: string) => controller.copyText(text));
  on("setup:cancel-filing", () => controller.cancelSetupFiling());
  on("setup:file-again", () => controller.fileSetupAgain());
}
