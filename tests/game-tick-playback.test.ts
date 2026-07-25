import { describe, expect, it, vi } from "vitest";
import { createLatestMoveRunner, performCommand } from "../site/game/command-runner.js";
import { TICK_DURATION_MS } from "../site/game/config.js";
import { playEngineResult } from "../site/game/tick-playback.js";

function dynamic(id: string, x: number, outcome = "ongoing") {
  return {
    entities: [{ id, type: "box", coordinate: { x, y: 0 }, bottomHalfSteps: 0 }],
    armedBarrelIds: [],
    activeSwitchColors: [],
    openDoorCoordinates: [],
    outcome,
  };
}

function full(state: ReturnType<typeof dynamic>) {
  return {
    coordinateSystem: { origin: { x: 0, y: 0 }, positiveX: "east", positiveY: "north" },
    width: 3,
    height: 1,
    cells: [],
    fixtures: [],
    ...state,
  };
}

function fakeView() {
  const calls: string[] = [];
  return {
    calls,
    setWorld: vi.fn(() => calls.push("world")),
    show: vi.fn((state) => calls.push(`show:${state.entities[0]?.coordinate.x ?? "empty"}`)),
    animateTo: vi.fn(async (state, _events, duration) => {
      calls.push(`animate:${state.entities[0]?.coordinate.x ?? "empty"}:${duration}`);
    }),
  };
}

describe("engine tick presentation", () => {
  it("uses the configured 250ms tick duration", () => {
    expect(TICK_DURATION_MS).toBe(250);
  });

  it("plays every authoritative tick sequentially at the configured duration", async () => {
    const view = fakeView();
    const states = [dynamic("1", 1), dynamic("1", 2, "won")];
    const seen: number[] = [];
    await playEngineResult({
      operation: "move",
      accepted: true,
      initialState: dynamic("1", 0),
      ticks: states.map((stateAfter, index) => ({ index, events: [], stateAfter })),
      state: full(states[1]),
    }, view, { onTickStart: (_tick, index) => seen.push(index) });

    expect(view.calls).toEqual([
      "show:0",
      `animate:1:${TICK_DURATION_MS}`,
      `animate:2:${TICK_DURATION_MS}`,
      "show:2",
    ]);
    expect(seen).toEqual([0, 1]);
  });

  it("presents initialization from the supplied state before its ticks", async () => {
    const view = fakeView();
    await playEngineResult({
      operation: "loadLevel",
      initialState: dynamic("8", 0),
      ticks: [{ index: 0, events: [], stateAfter: dynamic("8", 1) }],
      state: full(dynamic("8", 1)),
    }, view, { durationMs: 0 });
    expect(view.calls).toEqual(["world", "show:0", "animate:1:0", "show:1"]);
  });

  it("treats rewind as one synthetic transition and skips rejected moves", async () => {
    const rewindView = fakeView();
    await playEngineResult({
      operation: "rewind",
      accepted: true,
      events: [{ type: "stateRewound" }],
      state: full(dynamic("2", 0)),
    }, rewindView);
    expect(rewindView.animateTo).toHaveBeenCalledOnce();
    expect(rewindView.animateTo).toHaveBeenCalledWith(
      expect.objectContaining({ entities: expect.any(Array) }),
      [{ type: "stateRewound" }],
      TICK_DURATION_MS,
    );

    const rejectedView = fakeView();
    await playEngineResult({
      operation: "move",
      accepted: false,
      ticks: [],
      state: full(dynamic("2", 0)),
    }, rejectedView);
    expect(rejectedView.animateTo).not.toHaveBeenCalled();
  });

  it("keeps controls busy until asynchronous presentation finishes", async () => {
    let finishPresentation!: () => void;
    const presentation = new Promise<void>((resolve) => { finishPresentation = resolve; });
    const busy: boolean[] = [];
    const running = performCommand(
      () => ({ operation: "move" }),
      {
        setBusy: (value) => busy.push(value),
        present: async () => presentation,
        onError: vi.fn(),
      },
    );
    await Promise.resolve();
    expect(busy).toEqual([true]);
    finishPresentation();
    await running;
    expect(busy).toEqual([true, false]);
  });

  it("runs only the latest move buffered during tick presentation", async () => {
    const finishes: Array<() => void> = [];
    const seen: string[] = [];
    const runner = createLatestMoveRunner(async (direction) => {
      seen.push(direction);
      await new Promise<void>((resolve) => finishes.push(resolve));
    });

    const running = runner.request("north");
    await vi.waitFor(() => expect(seen).toEqual(["north"]));
    void runner.request("east");
    void runner.request("south");

    finishes.shift()!();
    await vi.waitFor(() => expect(seen).toEqual(["north", "south"]));
    finishes.shift()!();
    await running;

    expect(runner.isRunning()).toBe(false);
  });

  it("discards a buffered move when the first move ends the level", async () => {
    let finish!: () => void;
    let ongoing = true;
    const seen: string[] = [];
    const runner = createLatestMoveRunner(async (direction) => {
      seen.push(direction);
      await new Promise<void>((resolve) => { finish = resolve; });
      ongoing = false;
    }, { canMove: () => ongoing });

    const running = runner.request("east");
    await vi.waitFor(() => expect(seen).toEqual(["east"]));
    void runner.request("west");
    finish();
    await running;

    expect(seen).toEqual(["east"]);
  });
});
