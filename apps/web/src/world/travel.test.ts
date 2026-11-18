import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3-FGT-25: going to a hall without walking through its door (Quick Play, a meeting, a route change) keeps the live
 * place on screen while the hall gets ready, then cuts to it — never the full-screen boot screen over a frozen world.
 */
const cut = vi.fn((go: () => void) => go());
vi.mock("./doorway", () => ({ useDoorway: { getState: () => ({ phase: "idle", cut, pass: vi.fn() }) } }));
vi.mock("./navigation", () => ({ nav: { target: null, goal: null, progress: null }, releaseAllInput: () => undefined }));

vi.stubGlobal("location", { pathname: "/world" });
const { travelTo, useStage, stageNav } = await import("./stage");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  cut.mockClear();
  useStage.setState({ view: "plaza", ready: { outdoor: true }, warm: [], preparing: null, handoff: null });
  stageNav.push = vi.fn();
});
afterEach(async () => {
  // any travel still running ends (the view changed) before the next test
  useStage.setState({ view: null });
  await vi.advanceTimersByTimeAsync(100);
  vi.useRealTimers();
});

describe("travelTo: the world stays live while a hall gets ready", () => {
  it("keeps the plaza on screen, warms the hall and shows the small hint", () => {
    expect(travelTo("boxing", "/room/boxing")).toBe(true);
    const st = useStage.getState();
    expect(st.view).toBe("plaza");
    expect(st.warm).toEqual(["boxing"]);
    expect(st.preparing).toBe("boxing");
  });

  it("cuts to the hall once it is ready (and the URL follows the picture)", async () => {
    travelTo("boxing", "/room/boxing");
    await vi.advanceTimersByTimeAsync(500);
    expect(useStage.getState().view).toBe("plaza");
    useStage.getState().setReady("hall:boxing", true);
    await vi.advanceTimersByTimeAsync(800);
    expect(cut).toHaveBeenCalledTimes(1);
    expect(useStage.getState().view).toBe("hall:boxing");
    expect(useStage.getState().preparing).toBe(null);
    await vi.advanceTimersByTimeAsync(400);
    expect(stageNav.push).toHaveBeenCalledWith("/room/boxing");
  });

  it("gives up when you walk elsewhere meanwhile", async () => {
    travelTo("boxing", "/room/boxing");
    useStage.setState({ view: "hall:pool" });
    await vi.advanceTimersByTimeAsync(100);
    expect(useStage.getState().preparing).toBe(null);
    useStage.getState().setReady("hall:boxing", true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(useStage.getState().view).toBe("hall:pool");
  });

  it("falls back to the plain route change after a long wait", async () => {
    travelTo("boxing", "/room/boxing");
    await vi.advanceTimersByTimeAsync(26_000);
    expect(stageNav.push).toHaveBeenCalledWith("/room/boxing");
    expect(useStage.getState().preparing).toBe(null);
  });

  it("has nothing to keep live on a cold page: the caller shows the hall itself", () => {
    useStage.setState({ view: null });
    expect(travelTo("boxing", "/room/boxing")).toBe(false);
    useStage.setState({ view: "plaza", ready: {} });
    expect(travelTo("boxing", "/room/boxing")).toBe(false);
  });
});
