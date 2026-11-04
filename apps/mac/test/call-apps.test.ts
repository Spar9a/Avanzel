import { describe, expect, it } from "vitest";
import { CALL_APPS, callAppLabel, callAppsIn } from "../src/main/call-apps.ts";
import { parseProcesses } from "../src/main/running-apps.ts";

const PS = `  PID  PPID COMMAND
    1     0 launchd
  300     1 zoom.us
  301   300 zoom.us Helper
  302   301 CptHost
  400     1 Google Chrome
  401   400 Google Chrome Helper
  402   400 Google Chrome Helper (Renderer)
  500     1 Finder
  600     1 Slack
  601   600 Slack Helper
  700     1 Terminal
`;

describe("running processes", () => {
  it("reads pid, ppid and the command, which may hold spaces", () => {
    const processes = parseProcesses(PS);
    expect(processes).toHaveLength(11);
    expect(processes[1]).toEqual({ pid: 300, ppid: 1, command: "zoom.us" });
    expect(processes[6]).toEqual({ pid: 402, ppid: 400, command: "Google Chrome Helper (Renderer)" });
  });

  it("skips the header and lines it cannot read", () => {
    expect(parseProcesses("  PID  PPID COMMAND\nnonsense\n  7 1 a b\n")).toEqual([{ pid: 7, ppid: 1, command: "a b" }]);
    expect(parseProcesses("")).toEqual([]);
  });
});

describe("call apps", () => {
  it("lists the running ones in CALL_APPS order, each with its main process and all its children", () => {
    const apps = callAppsIn(parseProcesses(PS));
    expect(apps).toEqual([
      { name: "zoom.us", pids: [300, 301, 302] },
      { name: "Slack", pids: [600, 601] },
      { name: "Google Chrome", pids: [400, 401, 402] },
    ]);
    expect(CALL_APPS.indexOf("zoom.us")).toBeLessThan(CALL_APPS.indexOf("Slack"));
    expect(CALL_APPS.indexOf("Slack")).toBeLessThan(CALL_APPS.indexOf("Google Chrome"));
  });

  it("names nothing for apps that do not run", () => {
    expect(callAppsIn(parseProcesses("  PID  PPID COMMAND\n    1     0 launchd\n  500     1 Finder\n"))).toEqual([]);
  });

  it("names the apps the plan lists, without Safari until it is checked on a real Mac", () => {
    expect(CALL_APPS).toEqual([
      "zoom.us", "Microsoft Teams", "Slack", "FaceTime", "Discord", "Webex",
      "Google Chrome", "Arc", "Microsoft Edge", "Firefox",
    ]);
    expect(CALL_APPS).not.toContain("Safari");
  });
});

describe("call app labels", () => {
  it("names Zoom and Teams as people know them, the other call apps as they are, and an unknown process by its name", () => {
    expect(callAppLabel("zoom.us")).toBe("Zoom");
    expect(callAppLabel("MSTeams")).toBe("Microsoft Teams");
    expect(callAppLabel("Microsoft Teams")).toBe("Microsoft Teams");
    for (const name of ["Google Chrome", "Slack", "FaceTime", "Discord", "Webex", "Arc", "Microsoft Edge", "Firefox"]) {
      expect(callAppLabel(name)).toBe(name);
    }
    expect(callAppLabel("SomeHelper")).toBe("SomeHelper");
  });
});
