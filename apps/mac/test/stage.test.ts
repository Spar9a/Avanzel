import { afterEach, describe, expect, it, vi } from "vitest";

const focus = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ app: { focus } }));

const { bringForward, floatAbove, floatOverSpaces, panelOptions, stealFocus } = await import("../src/main/stage.ts");

function fakeWindow() {
  return {
    show: vi.fn(),
    showInactive: vi.fn(),
    focus: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  focus.mockClear();
});

describe("the stage in a real run", () => {
  it("brings a window forward and takes the keyboard", () => {
    const win = fakeWindow();
    bringForward(win as never);
    expect(focus).toHaveBeenCalledWith({ steal: true });
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it("floats panels over every Space", () => {
    const win = fakeWindow();
    expect(panelOptions()).toEqual({ alwaysOnTop: true });
    floatOverSpaces(win as never);
    floatAbove(win as never);
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
  });

  it("steals focus for a dialog", () => {
    stealFocus();
    expect(focus).toHaveBeenCalledWith({ steal: true });
  });
});

describe("the quiet stage", () => {
  it("shows a window without focus and leaves the app alone", () => {
    vi.stubEnv("AVANZEL_QUIET_STAGE", "1");
    const win = fakeWindow();
    bringForward(win as never);
    expect(focus).not.toHaveBeenCalled();
    expect(win.showInactive).toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
  });

  it("keeps panels on one Space and off the top", () => {
    vi.stubEnv("AVANZEL_QUIET_STAGE", "1");
    const win = fakeWindow();
    expect(panelOptions()).toEqual({});
    floatOverSpaces(win as never);
    floatAbove(win as never);
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("does not steal focus for a dialog", () => {
    vi.stubEnv("AVANZEL_QUIET_STAGE", "1");
    stealFocus();
    expect(focus).not.toHaveBeenCalled();
  });
});
