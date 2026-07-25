// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createLevel, toLevelDefinition } from "../site/editor/domain";

let module: any;

beforeAll(async () => {
  const { default: createGameRulesModule } = await import("../dist/wasm/game_rules.mjs");
  module = await createGameRulesModule();
});

function load(level: ReturnType<typeof toLevelDefinition>) {
  const engine = module.gameRules.createEngine();
  try { return engine.loadLevel(level); } finally { engine.destroy(); }
}

describe("authoritative editor validation", () => {
  it("accepts an all-feature authored level with exact stacks", () => {
    const document = createLevel({ width: 4, height: 3 });
    document.cells["0,1"] = { type: "flat", elevation: 0 };
    document.cells["1,1"] = { type: "ramp", lowDirection: "west", lowElevation: 0 };
    document.cells["2,1"] = { type: "flat", elevation: 1 };
    document.fixtures["0,0"] = { type: "switch", color: "blue" };
    document.fixtures["1,0"] = { type: "door", color: "blue" };
    document.fixtures["3,2"] = { type: "exit" };
    document.entities["2"] = { id: "2", type: "box", coordinate: { x: 2, y: 0 }, bottomHalfSteps: 0 };
    document.entities["3"] = { id: "3", type: "barrel", coordinate: { x: 2, y: 0 }, bottomHalfSteps: 2 };
    expect(load(toLevelDefinition(document)).status).toBe("loaded");
  });

  it.each([
    ["invalid_ramp_endpoints", (level: ReturnType<typeof createLevel>) => { level.cells["1,0"] = { type: "ramp", lowDirection: "west", lowElevation: 0 }; }],
    ["fixture_on_ramp", (level: ReturnType<typeof createLevel>) => { level.cells["1,0"] = { type: "ramp", lowDirection: "west", lowElevation: 0 }; level.cells["2,0"] = { type: "flat", elevation: 1 }; level.fixtures["1,0"] = { type: "exit" }; }],
    ["overlapping_entities", (level: ReturnType<typeof createLevel>) => { level.entities["2"] = { id: "2", type: "box", coordinate: { x: 1, y: 0 }, bottomHalfSteps: 0 }; level.entities["3"] = { id: "3", type: "barrel", coordinate: { x: 1, y: 0 }, bottomHalfSteps: 1 }; }],
    ["entity_below_surface", (level: ReturnType<typeof createLevel>) => { level.entities["2"] = { id: "2", type: "box", coordinate: { x: 1, y: 0 }, bottomHalfSteps: -1 }; }],
    ["player_not_top_of_stack", (level: ReturnType<typeof createLevel>) => { level.entities["2"] = { id: "2", type: "box", coordinate: { x: 0, y: 0 }, bottomHalfSteps: 2 }; }],
    ["player_count_not_one", (level: ReturnType<typeof createLevel>) => { level.entities = {}; }],
    ["invalid_teleporter_occupancy", (level: ReturnType<typeof createLevel>) => { level.fixtures["1,0"] = { type: "exit" }; level.entities["2"] = { id: "2", type: "box", coordinate: { x: 1, y: 0 }, bottomHalfSteps: 0 }; }],
  ])("reports %s", (code, mutate) => {
    const document = createLevel({ width: 3, height: 1 });
    mutate(document);
    const result = load(toLevelDefinition(document));
    expect(result.status).toBe("invalid_level");
    expect(result.errors.map((error: { code: string }) => error.code)).toContain(code);
  });
});
