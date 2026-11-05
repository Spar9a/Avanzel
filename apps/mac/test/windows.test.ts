import { describe, expect, it, vi } from "vitest";
import { settingsFrame } from "../src/main/windows.ts";

// Electron isn't loaded here: only the sum of where Settings goes is tested.
vi.mock("electron", () => ({ BrowserWindow: class {}, screen: {} }));

describe("settingsFrame: Settings takes the height its pane needs, within the screen", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  const at = (y: number, height = 500) => ({ x: 300, y, width: 680, height });

  it("keeps its top and its width, and takes the height asked for, rounded", () => {
    expect(settingsFrame(at(100), workArea, 612.4)).toEqual({ x: 300, y: 100, width: 680, height: 612 });
    expect(settingsFrame(at(100), workArea, 400)).toEqual({ x: 300, y: 100, width: 680, height: 400 });
  });

  it("a small pane still reads as a window, and a long one scrolls inside the most", () => {
    expect(settingsFrame(at(100), workArea, 90).height).toBe(320);
    expect(settingsFrame(at(25), workArea, 5000).height).toBe(800);
  });

  it("a short screen is as much as it gets", () => {
    const short = { x: 0, y: 25, width: 1280, height: 600 };
    expect(settingsFrame(at(25), short, 700)).toEqual({ x: 300, y: 25, width: 680, height: 600 });
  });

  it("moves up by what its bottom would go below the work area, and no further", () => {
    // 700 from 300 would end at 1000, and the work area ends at 900: 100 up.
    expect(settingsFrame(at(300), workArea, 700)).toEqual({ x: 300, y: 200, width: 680, height: 700 });
    // It doesn't go back down when the next pane is shorter.
    expect(settingsFrame(at(200, 700), workArea, 400)).toEqual({ x: 300, y: 200, width: 680, height: 400 });
  });

  it("follows the work area of a screen above or left of the main one", () => {
    const above = { x: -200, y: -1000, width: 1600, height: 975 };
    expect(settingsFrame({ x: 0, y: -400, width: 680, height: 500 }, above, 700)).toEqual({ x: 0, y: -725, width: 680, height: 700 });
  });
});
