// The Mac's Keychain as the cipher of the private model's key (`PrivateKeyStore`): Electron's safeStorage, which keeps its secret in a
// Keychain item of the app's own. It is here, apart from private-key.ts, so that what is tested of the store needs no Electron.
import { safeStorage } from "electron";
import type { KeyCipher } from "./private-key.ts";

export const keychainCipher: KeyCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (bytes) => safeStorage.decryptString(bytes),
};
