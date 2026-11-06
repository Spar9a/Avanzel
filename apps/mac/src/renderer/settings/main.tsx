// The Settings window: Settings (`SettingsApp`) in a window of its own. Used where the menu bar panel isn't (the e2e tests);
// elsewhere Settings is the panel's third tab.
import "@avanzel/ui/base.css";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "./SettingsApp.tsx";

createRoot(document.getElementById("root")!).render(<SettingsApp />);
