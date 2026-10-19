import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("avanzel", {});
