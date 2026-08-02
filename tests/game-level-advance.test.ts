import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEXT_LEVEL_DELAY_MS,
  createLevelAdvanceController,
} from "../site/game/level-advance.js";

const levels = [
  { id: "01-welcome" },
  { id: "02-stack" },
  { id: "03-finale" },
];

afterEach(() => vi.useRealTimers());

describe("canned level auto-advance", () => {
  it("advances to the next level three seconds after a win", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const controller = createLevelAdvanceController({
      levels,
      getCurrentLevelId: () => "01-welcome",
      advance,
    });

    controller.update("won");
    vi.advanceTimersByTime(NEXT_LEVEL_DELAY_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledWith(levels[1]);
  });

  it("does not advance editor playtests or the final canned level", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const editorController = createLevelAdvanceController({
      levels,
      getCurrentLevelId: () => null,
      advance,
    });
    const finalController = createLevelAdvanceController({
      levels,
      getCurrentLevelId: () => "03-finale",
      advance,
    });

    editorController.update("won");
    finalController.update("won");
    vi.runAllTimers();
    expect(advance).not.toHaveBeenCalled();
  });

  it("cancels a pending advance when the level returns to an ongoing state", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const controller = createLevelAdvanceController({
      levels,
      getCurrentLevelId: () => "02-stack",
      advance,
    });

    controller.update("won");
    controller.update("won");
    controller.update("ongoing");
    vi.runAllTimers();
    expect(advance).not.toHaveBeenCalled();
  });
});
