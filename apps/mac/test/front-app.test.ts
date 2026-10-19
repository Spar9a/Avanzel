import { describe, expect, it } from "vitest";
import { browserScript, parseBrowserResult, parseLsappinfo } from "../src/main/front-app.ts";

describe("front app context", () => {
  it("reads the name and bundle id that lsappinfo prints", () => {
    const out = '"LSDisplayName"="Safari"\n"CFBundleIdentifier"="com.apple.Safari"\n';
    expect(parseLsappinfo(out)).toEqual({ name: "Safari", bundleId: "com.apple.Safari" });
    expect(parseLsappinfo("")).toEqual({});
  });

  it("asks Safari and Chromium browsers for the tab, and nothing else", () => {
    expect(browserScript("com.apple.Safari")).toContain("current tab of front window");
    for (const id of ["com.google.Chrome", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac"]) {
      expect(browserScript(id)).toContain("active tab of front window");
      expect(browserScript(id)).toContain(`application id "${id}"`);
    }
    expect(browserScript("com.apple.finder")).toBeNull();
  });

  it("splits the script result into url and title", () => {
    expect(parseBrowserResult("https://shure.com/mv7\nShure MV7+ Podcast Microphone\n")).toEqual({
      url: "https://shure.com/mv7",
      title: "Shure MV7+ Podcast Microphone",
    });
    expect(parseBrowserResult("")).toEqual({});
  });
});
