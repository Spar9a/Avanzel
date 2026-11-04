import { describe, expect, it } from "vitest";
import { browserScript, browserWindow, parseBrowserResult, parseBrowserWindow, parseLsappinfo } from "../src/main/front-app.ts";

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

describe("the browser window a dictation went to", () => {
  it("asks a Chromium browser for its front window's mode in the same call as the tab, and Safari for the tab alone", () => {
    for (const id of ["com.google.Chrome", "com.brave.Browser", "com.microsoft.edgemac"]) {
      const script = browserScript(id, { mode: true })!;
      expect(script).toContain("mode of front window");
      expect(script).toContain("active tab of front window");
    }
    expect(browserScript("com.apple.Safari", { mode: true })).not.toContain("mode of");
    // The screenshot's context asks what it always did.
    expect(browserScript("com.google.Chrome")).not.toContain("mode of");
    expect(browserScript("com.apple.finder", { mode: true })).toBeNull();
  });

  it("asks Chrome Canary and Chrome Dev as the Chrome they are, so their private windows are told apart too", async () => {
    for (const id of ["com.google.Chrome.canary", "com.google.Chrome.dev"]) {
      expect(browserScript(id, { mode: true })).toContain("mode of front window");
      expect(await browserWindow(id, async () => "incognito\nhttps://a.example/\nA\n")).toEqual({ address: "https://a.example/", privateWindow: true });
      await expect(browserWindow(id, async () => "")).rejects.toThrow();
    }
  });

  it("reads a Chromium window's mode: incognito is private, normal is not, and anything else can't be told", () => {
    expect(parseBrowserWindow("incognito\nhttps://mail.example.com/inbox\nInbox\n", "chromium")).toEqual({
      address: "https://mail.example.com/inbox",
      privateWindow: true,
    });
    expect(parseBrowserWindow("normal\nhttps://example.com/\nExample\n", "chromium")).toEqual({ address: "https://example.com/", privateWindow: false });
    expect(parseBrowserWindow("normal\n\n\n", "chromium")).toEqual({ privateWindow: false });
    expect(() => parseBrowserWindow("", "chromium")).toThrow();
    expect(() => parseBrowserWindow("guest\nhttps://example.com/\n", "chromium")).toThrow();
  });

  it("reads Safari's address only: whether its window is private can't be asked", () => {
    expect(parseBrowserWindow("https://example.com/a\nA page\n", "safari")).toEqual({ address: "https://example.com/a" });
    expect(parseBrowserWindow("", "safari")).toEqual({});
  });

  it("asks only browsers, and refuses (rejects) when a Chromium browser's answer fails or never comes", async () => {
    const asked: string[][] = [];
    const answer = (out: string) => async (_file: string, args: string[]) => {
      asked.push(args);
      return out;
    };
    expect(await browserWindow("com.tinyspeck.slackmacgap", answer("x"))).toBeNull();
    expect(asked).toEqual([]);
    expect(await browserWindow("com.google.Chrome", answer("incognito\nhttps://a.example/\nA\n"))).toEqual({ address: "https://a.example/", privateWindow: true });
    expect(await browserWindow("com.apple.Safari", answer("https://b.example/\nB\n"))).toEqual({ address: "https://b.example/" });
    const failing = async () => {
      throw new Error("Command failed: osascript (timed out)");
    };
    await expect(browserWindow("com.google.Chrome", failing)).rejects.toThrow();
    await expect(browserWindow("com.apple.Safari", failing)).rejects.toThrow();
    await expect(browserWindow("com.google.Chrome", answer(""))).rejects.toThrow();
  });
});
