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
  handle("settings:download-model", () => controller.downloadModel());
  handle("settings:save-task", (_e, task: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">) =>
    controller.saveTaskFromSettings(task));
  handle("settings:run-task", (_e, id: string) => controller.runTask(id));
  handle("settings:check-agents", () => controller.checkAgents());
  handle("settings:check-agent", (_e, name: string) => controller.checkAgent(name));
  handle("settings:request-permission", (_e, kind: "microphone" | "screen") => controller.requestPermission(kind));
  // What the page sends is checked where it is used: this takes anything, and shows a menu only for a request that reads.
  handle("settings:pick", (_e, options: unknown, at: unknown) => controller.pickFromSettings(options, at));
  on("settings:open-library", () => controller.openLibraryFolder());
  on("settings:show-library", () => controller.showLibraryInFinder());
  on("settings:open-setup", () => controller.openSetupFromSettings());
  on("settings:open-privacy", (_e, pane: "microphone" | "screen") => void controller.openPrivacy(pane));

  // quick type & ask
  handle("quick:submit", (_e, text: string) => controller.submitQuick(text));
  on("quick:close", () => controller.closeQuick());
  handle("ask:ask", (_e, question: string) => controller.ask(question));
  on("ask:open-page", (_e, name: string) => controller.openPageByName(name));
  on("ask:close", () => controller.closeAsk());

  // setup
  handle("setup:get", () => controller.setup.snapshot());
  handle("setup:enter", (_e, step: SetupStep) => controller.setup.enterSetupStep(step));
  handle("setup:choose-agent", (_e, name: string) => controller.setup.chooseSetupAgent(name));
  handle("setup:create-library", () => controller.setup.createSetupLibrary());
  handle("setup:choose-folder", () => controller.setup.chooseSetupFolder());
  // What the page sends is checked where it is used: these take anything, and act only on what setup offers.
  handle("setup:use-shortcut", (_e, accelerator: unknown) => controller.setup.useSetupShortcut(accelerator));
  handle("setup:type-thought", (_e, words: unknown) => controller.setup.typeSetupThought(words));
  handle("setup:ask", (_e, question: unknown) => controller.setup.askInSetup(question));
  on("setup:open-terminal", () => controller.setup.openTerminal());
  on("setup:reach-for-shortcut", () => controller.setup.reachForShortcut());
  on("setup:copy", (_e, agent: unknown) => controller.setup.copyInstall(agent));
  on("setup:cancel-filing", () => controller.setup.cancelSetupFiling());
  on("setup:file-again", () => controller.setup.fileSetupAgain());
  on("setup:undo", () => void controller.setup.undoSetupFiling());
  on("setup:allow-microphone", () => void controller.setup.allowMicrophone());
  on("setup:try-again", () => controller.setup.retrySetupThought());
  on("setup:file-anyway", () => controller.setup.fileSetupAnyway());
  on("setup:skip-ask", () => controller.setup.skipSetupAsk());
  on("setup:finish", () => void controller.setup.finish());

  // the bubble under the menu bar icon, once setup has ended
  handle("up-here:get", () => controller.setup.upHereSnapshot());
  on("up-here:try-it", () => controller.setup.tryItNow());
  on("up-here:type-it", () => controller.setup.typeFromUpHere());
  on("up-here:close", () => controller.setup.closeUpHere());
}
