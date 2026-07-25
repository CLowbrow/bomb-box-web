import { describe, expect, it } from "vitest";
import {
  ENTITY_HEIGHTS,
  SCENE_UNITS,
  cellSurfaceRange,
  coordinateToWorld,
  entityTransform,
  rampCornerHeights,
  terrainBaselineElevation,
  terrainColumnSegments,
} from "../site/game/scene-model.js";

function world(positiveX = "east", positiveY = "north") {
  return {
    coordinateSystem: { origin: { x: 10, y: -4 }, positiveX, positiveY },
    width: 3,
    height: 2,
  };
}

describe("three-dimensional game scene mapping", () => {
  it("maps authored axes to screen-right east and screen-up north", () => {
    expect(coordinateToWorld({ x: 10, y: -4 }, world())).toEqual({ x: -1, z: 0.5 });
    expect(coordinateToWorld({ x: 12, y: -3 }, world())).toEqual({ x: 1, z: -0.5 });
    expect(coordinateToWorld({ x: 10, y: -4 }, world("west", "south"))).toEqual({ x: 1, z: -0.5 });
    expect(coordinateToWorld({ x: 12, y: -3 }, world("west", "south"))).toEqual({ x: -1, z: 0.5 });
  });

  it("uses one compressed level for floors, boxes, and barrels", () => {
    expect(SCENE_UNITS.levelHeight).toBe(0.65);
    expect(SCENE_UNITS.halfStep).toBe(0.325);
    expect(ENTITY_HEIGHTS.box).toBe(0.65);
    expect(ENTITY_HEIGHTS.barrel).toBe(0.65);
    expect(ENTITY_HEIGHTS.player).toBeGreaterThan(0.65);
    expect(SCENE_UNITS.doorHeight).toBeGreaterThan(0.65);

    const box = entityTransform({
      id: "1",
      type: "box",
      coordinate: { x: 10, y: -4 },
      bottomHalfSteps: -2,
    }, world());
    const barrel = entityTransform({
      id: "2",
      type: "barrel",
      coordinate: { x: 10, y: -4 },
      bottomHalfSteps: 0,
    }, world());
    expect(box.y).toBe(-0.65);
    expect(box.y + box.height).toBe(barrel.y);
  });

  it("maps flat and ramp elevations using the same vertical scale", () => {
    expect(cellSurfaceRange({ type: "flat", elevation: -2 })).toEqual({ low: -1.3, high: -1.3 });
    const ramp = cellSurfaceRange({ type: "ramp", lowElevation: 2 });
    expect(ramp.low).toBeCloseTo(1.3);
    expect(ramp.high).toBeCloseTo(1.95);
  });

  it("orients each ramp's low edge in cardinal world space", () => {
    expect(rampCornerHeights("north")).toEqual([0, 0, 0.65, 0.65]);
    expect(rampCornerHeights("south")).toEqual([0.65, 0.65, 0, 0]);
    expect(rampCornerHeights("east")).toEqual([0.65, 0, 0, 0.65]);
    expect(rampCornerHeights("west")).toEqual([0, 0.65, 0.65, 0]);
  });

  it("builds elevated terrain upward from a shared half-step baseline", () => {
    const cells = [
      { type: "flat", elevation: 0 },
      { type: "flat", elevation: 3 },
      { type: "ramp", lowElevation: 1 },
    ];
    const baseline = terrainBaselineElevation(cells);
    expect(baseline).toBe(-0.5);
    expect(terrainColumnSegments(0, baseline)).toEqual([
      { bottom: -0.325, top: 0 },
    ]);

    const tallColumn = terrainColumnSegments(3, baseline);
    expect(tallColumn).toHaveLength(4);
    expect(tallColumn[0]).toEqual({ bottom: -0.325, top: 0 });
    expect(tallColumn[1]).toEqual({ bottom: 0.025, top: 0.65 });
    expect(tallColumn[2].bottom).toBeCloseTo(0.675);
    expect(tallColumn[2].top).toBeCloseTo(1.3);
    expect(tallColumn[3].bottom).toBeCloseTo(1.325);
    expect(tallColumn[3].top).toBeCloseTo(1.95);
  });

  it("extends the shared baseline below negative terrain when present", () => {
    const cells = [
      { type: "flat", elevation: -2 },
      { type: "flat", elevation: 1 },
    ];
    const baseline = terrainBaselineElevation(cells);
    expect(baseline).toBe(-2.5);
    expect(terrainColumnSegments(-2, baseline)).toEqual([
      { bottom: -1.625, top: -1.3 },
    ]);
    expect(terrainColumnSegments(1, baseline)).toHaveLength(4);
  });
});
