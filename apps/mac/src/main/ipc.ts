// Wires the preload bridge's channels to the controller.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { AppSettings, LibraryPatch, SetupStep, Shortcuts, TaskInfo } from "../shared/ipc.ts";
import type { Controller } from "./controller.ts";

type Handler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;

export function registerIpc(controller: Controller): void {
  const handle = (channel: string, fn: Handler) => ipcMain.handle(channel, fn as Parameters<typeof ipcMain.handle>[1]);
  const on = (channel: string, fn: (event: IpcMainEvent, ...args: never[]) => void) =>
    ipcMain.on(channel, fn as Parameters<typeof ipcMain.on>[1]);

  // capsule
  on("capsule:ready", () => controller.capsuleReady());
  handle("capsule:audio", (_e, samples: Float32Array) => controller.onAudio(samples));
  on("capsule:live-audio", (e, samples: Float32Array) => controller.onLiveAudio(e.sender, samples)); // only the capsule's own page is heard
  // only the capsule's own page sends a call's microphone, and stops a call from its card
  handle("capsule:call-audio", (e, call: number, samples: Float32Array, last: boolean) => controller.onCallAudio(e.sender, call, samples, last));
  on("capsule:stop-call", (e) => void controller.stopCall(e.sender));
  on("capsule:mic-error", (e, message: string) => controller.micErrorFrom(e.sender, message)); // only the capsule's own page ends a recording or a call
  on("capsule:interactive", (_e, interactive: boolean) => controller.setInteractive(interactive));
  on("capsule:edit", () => controller.edit());
  on("capsule:edit-draft", (_e, text: string) => controller.editDraft(text));
  on("capsule:submit-edit", (_e, text: string) => controller.submitEdit(text));
  on("capsule:cancel-edit", () => controller.cancelEdit());
  on("capsule:cancel-filing", (e) => controller.cancelFiling(e.sender)); // only the capsule's own page stops its filing
  on("capsule:toggle-file-mode", (e) => controller.toggleFileMode(e.sender)); // only the capsule's own page switches its capture's mode
  on("capsule:stop-transcribing", (e) => void controller.stopTranscribing(e.sender)); // only the capsule's own page stops its transcription
  on("capsule:undo", () => void controller.undo());
  on("capsule:open", () => controller.openFiled());
  // What the page sends is checked where it is used: only the capsule's own page is heard, and only for a page its filing wrote.
  on("capsule:open-page", (e, rel: unknown) => controller.openFiledPage(e.sender, rel));
  on("capsule:dismiss", () => controller.dismiss());
  on("capsule:keep-open", (_e, keep: boolean) => controller.setKeepOpen(keep));
  on("capsule:open-settings-for", (_e, action: string) => controller.openSettingsFor(action));
  on("capsule:retry-download", () => controller.retryDownload());
  on("capsule:type-instead", () => controller.typeInstead());
  on("capsule:use-shortcut", (_e, key: keyof Shortcuts, accelerator: string) => void controller.useShortcut(key, accelerator));

  // settings
  handle("settings:get", () => controller.snapshot());
  handle("settings:set-app", (_e, patch: Partial<AppSettings>) => controller.setApp(patch));
  handle("settings:set-cursor-dictation", (_e, patch: Partial<AppSettings["cursorDictation"]>) => controller.setCursorDictation(patch));
  handle("settings:cursor-permissions", () => controller.cursorPermissions());
  handle("settings:ask-cursor-permissions", () => controller.askCursorPermissions());
  // The history holds what people said into other apps: only the Settings window's own page is answered.
  handle("settings:list-dictations", (e, limit: unknown) =>
    controller.isSettingsPage(e.sender) ? controller.listDictations(typeof limit === "number" ? limit : undefined) : { rows: [], total: 0 });
  handle("settings:copy-dictation", (e, id: unknown) => (controller.isSettingsPage(e.sender) && typeof id === "string" ? controller.copyDictation(id) : false));
  handle("settings:delete-dictation", (e, id: unknown) =>
    controller.isSettingsPage(e.sender) && typeof id === "string" ? controller.deleteDictation(id) : { ok: false, message: "Only Settings can delete a dictation." });
  handle("settings:set-library", (_e, patch: LibraryPatch) => controller.setLibrarySettings(patch));
  handle("settings:choose-library", () => controller.chooseLibrary());
  handle("settings:download-model", () => controller.downloadModel());
  handle("settings:save-task", (_e, task: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">) =>
    controller.saveTaskFromSettings(task));
  handle("settings:run-task", (_e, id: string) => controller.runTaskFromSettings(id));
  handle("settings:check-agents", () => controller.checkAgents());
  handle("settings:check-agent", (_e, name: string) => controller.checkAgent(name));
  handle("settings:request-permission", (_e, kind: "microphone" | "screen") => controller.requestPermission(kind));
  // What the page sends is checked where it is used: this takes anything, and shows a menu only for a request that reads. Every
  // window has the same bridge, so it also hands over the page that sent it: only the Settings window's own is answered.
  handle("settings:pick", (e, options: unknown, at: unknown) => controller.pickFromSettings(e.sender, options, at));
  on("settings:open-library", () => controller.openLibraryFolder());
  on("settings:show-library", () => controller.showLibraryInFinder());
  on("settings:open-setup", () => controller.openSetupFromSettings());
  on("settings:open-privacy", (_e, pane: "microphone" | "screen") => void controller.openPrivacy(pane));
  on("settings:relaunch", () => controller.relaunch());

  // quick type & ask
  handle("quick:submit", (_e, text: string) => controller.submitQuick(text));
  on("quick:close", () => controller.closeQuick());
  handle("ask:ask", (_e, question: string) => controller.ask(question));
  handle("ask:save", (e, question: string, answer: string, library: string | null) => controller.saveAnswer(e.sender, question, answer, library)); // only the Ask window's own page saves
  handle("ask:undo-save", (e, commit: string) => controller.undoSave(e.sender, commit)); // only the Ask window's own page takes back a save it was handed
  on("ask:cancel", (e) => controller.cancelAsk(e.sender)); // only the Ask window's own page gives up its question or save
  on("ask:open-page", (_e, name: string) => controller.openPageByName(name));
  on("ask:close", () => controller.closeAsk());
  handle("ask:get", () => controller.askSnapshot()); // the shelves counted once, with the suggestions and the dictate shortcut

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
  on("setup:install-git", () => controller.setup.installGit());
  on("setup:cancel-filing", () => controller.setup.cancelSetupFiling());
  on("setup:file-again", () => controller.setup.fileSetupAgain());
  on("setup:undo", () => void controller.setup.undoSetupFiling());
  on("setup:allow-microphone", () => void controller.setup.allowMicrophone());
  handle("setup:ask-for-microphone", () => controller.setup.askForMicrophone());
  on("setup:open-screen-settings", () => void controller.setup.openScreenSettings());
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
