import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallOffer, callAppName, type OfferedApp, type OfferHost } from "../src/main/call-offer.ts";
import type { MicHolder } from "../src/main/mic-watch.ts";

const chrome: MicHolder = { pid: 1234, bundle: "com.google.Chrome.helper", appPid: 1200, app: "Google Chrome", path: "/Applications/Google Chrome.app" };
const zoom: MicHolder = { pid: 20707, bundle: "us.zoom.xos", appPid: 20707, app: "zoom.us", path: "/Applications/zoom.us.app" };
const chromeApp: OfferedApp = { pid: 1200, name: "Google Chrome", path: "/Applications/Google Chrome.app" };
const zoomApp: OfferedApp = { pid: 20707, name: "Zoom", path: "/Applications/zoom.us.app" };

interface Fixture {
  offer: CallOffer;
  flags: { canAsk: boolean; callRunning: boolean; ownPids: Set<number> };
  asked: OfferedApp[];
  withdrawn: number[];
  taken: OfferedApp[];
}

function setup(): Fixture {
  const flags = { canAsk: true, callRunning: false, ownPids: new Set<number>() };
  const asked: OfferedApp[] = [];
  const withdrawn: number[] = [];
  const taken: OfferedApp[] = [];
  const host: OfferHost = {
    ownPids: () => flags.ownPids,
    canAsk: () => flags.canAsk,
    callRunning: () => flags.callRunning,
    ask: (app) => void asked.push(app),
    withdraw: () => void withdrawn.push(Date.now()),
    take: (app) => void taken.push(app),
  };
  return { offer: new CallOffer(host), flags, asked, withdrawn, taken };
}

const tick = (ms: number) => vi.advanceTimersByTime(ms);

describe("CallOffer", () => {
  let f: Fixture;
  beforeEach(() => {
    vi.useFakeTimers();
    f = setup();
  });
  afterEach(() => {
    f.offer.dispose();
    vi.useRealTimers();
  });

  it("asks about an app that holds the microphone for 5 s, and not before", () => {
    f.offer.holders([chrome]);
    tick(4_999);
    expect(f.asked).toEqual([]);
    tick(1);
    expect(f.asked).toEqual([chromeApp]);
    expect(f.offer.asking).toEqual(chromeApp);
  });

  it("never asks about Avanzel's own processes", () => {
    const own: MicHolder = { pid: 8757, bundle: "app.avanzel.mac.helper", appPid: 8677, app: "Avanzel", path: "/Applications/Avanzel.app" };
    f.flags.ownPids = new Set([8757, 8677]);
    f.offer.holders([own]);
    tick(20_000);
    expect(f.asked).toEqual([]);
    // Either id alone is enough: the helper's own pid, or the app it belongs to.
    f.flags.ownPids = new Set([8757]);
    f.offer.holders([own]);
    tick(20_000);
    f.flags.ownPids = new Set([8677]);
    f.offer.holders([own]);
    tick(20_000);
    expect(f.asked).toEqual([]);
  });

  it("never asks about a daemon that isn't in DAEMON_APPS", () => {
    f.offer.holders([{ pid: 300, bundle: "com.apple.audio.daemon", appPid: null, app: null, path: null }]);
    tick(20_000);
    expect(f.asked).toEqual([]);
  });

  it("a daemon in DAEMON_APPS is asked about under the app's name", () => {
    f.offer.holders([{ pid: 555, bundle: "com.apple.avconferenced", appPid: null, app: null, path: null }]);
    tick(5_000);
    expect(f.asked).toEqual([{ pid: 555, name: "FaceTime", path: null }]);
  });

  it("asks about Zoom by the name people know, not zoom.us", () => {
    f.offer.holders([zoom]);
    tick(5_000);
    expect(f.asked).toEqual([zoomApp]);
    expect(f.asked[0]?.name).toBe("Zoom");
  });

  it("a blip under 1 s doesn't restart the hold", () => {
    f.offer.holders([chrome]);
    tick(3_000);
    f.offer.holders([]);
    tick(500);
    f.offer.holders([chrome]);
    tick(1_499);
    expect(f.asked).toEqual([]);
    tick(1);
    expect(f.asked).toEqual([chromeApp]);
  });

  it("a gap of 1 s or more restarts the hold", () => {
    f.offer.holders([chrome]);
    tick(3_000);
    f.offer.holders([]);
    tick(1_000);
    f.offer.holders([chrome]);
    tick(4_999);
    expect(f.asked).toEqual([]);
    tick(1);
    expect(f.asked).toEqual([chromeApp]);
  });

  it("Not now lasts until the app has let go for 10 s", () => {
    f.offer.holders([chrome]);
    tick(5_000);
    f.offer.answer(false);
    expect(f.offer.asking).toBeNull();
    f.offer.holders([]);
    tick(9_000);
    f.offer.holders([chrome]);
    tick(20_000);
    expect(f.asked).toEqual([chromeApp]);
    f.offer.holders([]);
    tick(10_000);
    f.offer.holders([chrome]);
    tick(4_999);
    expect(f.asked).toHaveLength(1);
    tick(1);
    expect(f.asked).toEqual([chromeApp, chromeApp]);
  });

  it("present during a call counts as answered", () => {
    f.flags.callRunning = true;
    f.offer.holders([zoom]);
    tick(10_000);
    f.flags.callRunning = false;
    f.offer.recheck();
    tick(10_000);
    expect(f.asked).toEqual([]);
  });

  it("a call that starts while asking withdraws the question", () => {
    f.offer.holders([chrome]);
    tick(5_000);
    expect(f.offer.asking).toEqual(chromeApp);
    f.flags.callRunning = true;
    f.offer.recheck();
    expect(f.offer.asking).toBeNull();
    expect(f.withdrawn).toHaveLength(1);
    f.flags.callRunning = false;
    f.offer.recheck();
    expect(f.asked).toEqual([chromeApp]);
  });

  it("waits for a free capsule, then asks", () => {
    f.flags.canAsk = false;
    f.offer.holders([chrome]);
    tick(6_000);
    expect(f.asked).toEqual([]);
    f.flags.canAsk = true;
    f.offer.recheck();
    expect(f.asked).toEqual([chromeApp]);
  });

  it("gaveWay asks again later; answer(false) does not", () => {
    f.offer.holders([chrome]);
    tick(5_000);
    f.offer.gaveWay();
    expect(f.offer.asking).toBeNull();
    f.offer.recheck();
    expect(f.asked).toEqual([chromeApp, chromeApp]);
    f.offer.answer(false);
    f.offer.recheck();
    tick(20_000);
    expect(f.asked).toHaveLength(2);
    expect(f.taken).toEqual([]);
  });

  it("Take notes hands the app to take, once", () => {
    f.offer.holders([chrome]);
    tick(5_000);
    f.offer.answer(true);
    expect(f.taken).toEqual([chromeApp]);
    expect(f.offer.asking).toBeNull();
    f.offer.answer(true);
    f.offer.answer(false);
    f.offer.gaveWay();
    f.offer.recheck();
    tick(20_000);
    expect(f.taken).toHaveLength(1);
    expect(f.asked).toHaveLength(1);
  });

  it("an app that lets go while asked withdraws the question after 10 s", () => {
    f.offer.holders([chrome]);
    tick(5_000);
    f.offer.holders([]);
    tick(9_999);
    expect(f.withdrawn).toEqual([]);
    expect(f.offer.asking).toEqual(chromeApp);
    tick(1);
    expect(f.withdrawn).toHaveLength(1);
    expect(f.offer.asking).toBeNull();
  });

  it("two apps: the first past 5 s is asked about, one question at a time", () => {
    f.offer.holders([chrome]);
    tick(2_000);
    f.offer.holders([chrome, zoom]);
    tick(3_000);
    expect(f.asked).toEqual([chromeApp]);
    tick(10_000);
    expect(f.asked).toEqual([chromeApp]);
    f.offer.answer(false);
    f.offer.recheck();
    expect(f.asked).toEqual([chromeApp, zoomApp]);
  });

  it("two apps: the one held longest is asked about first, not the one seen first", () => {
    f.flags.canAsk = false;
    f.offer.holders([chrome]);
    tick(1_000);
    f.offer.holders([chrome, zoom]);
    tick(500);
    // Chrome lets go for over a second and comes back, so its hold starts again after Zoom's.
    f.offer.holders([zoom]);
    tick(1_100);
    f.offer.holders([chrome, zoom]);
    tick(5_400);
    f.flags.canAsk = true;
    f.offer.recheck();
    expect(f.asked).toEqual([zoomApp]);
  });

  it("a held entry's several holders are one entry", () => {
    f.offer.holders([chrome, { ...chrome, pid: 1235 }]);
    tick(5_000);
    expect(f.asked).toEqual([chromeApp]);
  });

  it("a host that rechecks from inside ask leaves no second timer behind", () => {
    const asked: OfferedApp[] = [];
    let offer: CallOffer;
    offer = new CallOffer({
      ownPids: () => new Set(),
      canAsk: () => true,
      callRunning: () => false,
      ask: (app) => {
        asked.push(app);
        offer.recheck();
      },
      withdraw: () => offer.recheck(),
      take: () => {},
    });
    offer.holders([chrome]);
    tick(2_000);
    offer.holders([chrome, zoom]);
    tick(3_000);
    expect(asked).toEqual([chromeApp]);
    expect(vi.getTimerCount()).toBe(1);
    offer.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing after dispose", () => {
    f.offer.holders([chrome]);
    f.offer.dispose();
    tick(20_000);
    f.offer.holders([chrome]);
    f.offer.recheck();
    expect(f.asked).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("callAppName", () => {
  it("gives Zoom its everyday name", () => {
    expect(callAppName("zoom.us")).toBe("Zoom");
  });

  it("passes every other name through unchanged", () => {
    expect(callAppName("Google Chrome")).toBe("Google Chrome");
  });
});
