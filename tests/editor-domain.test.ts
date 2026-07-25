import { describe, expect, it } from "vitest";
import {
  coordinateKey,
  createLevel,
  entitiesAt,
  fromLevelDefinition,
  resizeDocument,
  screenCoordinates,
  serializeLevel,
  toLevelDefinition,
  translateDocument,
} from "../site/editor/domain";
import { editorReducer, initialEditorState } from "../site/editor/reducer";
import type { LevelDefinitionV1 } from "../site/editor/types";

describe("level document conversion", () => {
  it("serializes deterministic engine JSON without editor metadata", () => {
    const document = createLevel({
      width: 2,
      height: 2,
      originX: -4,
      originY: 7,
      positiveX: "west",
      positiveY: "south",
      elevation: -2,
    });
    document.entities["18446744073709551615"] = {
      id: "18446744073709551615",
      type: "box",
      coordinate: { x: -3, y: 8 },
      bottomHalfSteps: -1,
    };
    document.fixtures["-3,8"] = { type: "door", color: "blue" };

    const parsed = JSON.parse(serializeLevel(document)) as LevelDefinitionV1;
    expect(parsed.coordinateSystem).toEqual({
      origin: { x: -4, y: 7 },
      positiveX: "west",
      positiveY: "south",
    });
    expect(parsed.cells.map(({ coordinate }) => coordinate)).toEqual([
      { x: -4, y: 7 }, { x: -3, y: 7 }, { x: -4, y: 8 }, { x: -3, y: 8 },
    ]);
    expect(parsed.entities.at(-1)?.id).toBe("18446744073709551615");
    expect(parsed).not.toHaveProperty("displayName");
    expect(serializeLevel(document).endsWith("\n")).toBe(true);
  });

  it("normalizes a shape-correct incomplete imported grid for repair", () => {
    const level = toLevelDefinition(createLevel({ width: 2, height: 1 }));
    level.cells = [level.cells[0]];
    const document = fromLevelDefinition(level);
    expect(Object.keys(document.cells)).toEqual(["0,0", "1,0"]);
    expect(document.cells["1,0"]).toEqual({ type: "flat", elevation: 0 });
  });

  it("orders screen coordinates according to declared axes", () => {
    const document = createLevel({ width: 2, height: 2, positiveX: "west", positiveY: "north" });
    expect(screenCoordinates(document)).toEqual([
      { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 },
    ]);
  });
});

describe("editor reducer", () => {
  it("places exact stacks and relocates the sole player", () => {
    let state = initialEditorState(createLevel({ width: 3, height: 1 }));
    state = editorReducer(state, { type: "setTool", tool: "box" });
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 1, y: 0 } });
    state = editorReducer(state, { type: "setTool", tool: "barrel" });
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 1, y: 0 } });
    expect(entitiesAt(state.document, { x: 1, y: 0 }).map((entity) => [entity.type, entity.bottomHalfSteps])).toEqual([
      ["box", 0], ["barrel", 2],
    ]);

    state = editorReducer(state, { type: "setTool", tool: "player" });
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 1, y: 0 } });
    const players = Object.values(state.document.entities).filter((entity) => entity.type === "player");
    expect(players).toEqual([expect.objectContaining({ id: "1", coordinate: { x: 1, y: 0 }, bottomHalfSteps: 4 })]);
  });

  it("edits exact half-step heights and supports undo and redo", () => {
    let state = initialEditorState(createLevel());
    const player = state.document.entities["1"];
    state = editorReducer(state, {
      type: "updateEntity",
      originalId: "1",
      entity: { ...player, bottomHalfSteps: 7 },
    });
    expect(state.document.entities["1"].bottomHalfSteps).toBe(7);
    state = editorReducer(state, { type: "undo" });
    expect(state.document.entities["1"].bottomHalfSteps).toBe(0);
    state = editorReducer(state, { type: "redo" });
    expect(state.document.entities["1"].bottomHalfSteps).toBe(7);
  });

  it("copies terrain, fixtures, and complete stacks with fresh non-player IDs", () => {
    let state = initialEditorState(createLevel({ width: 2, height: 1 }));
    state = editorReducer(state, {
      type: "setCellGeometry",
      coordinate: { x: 0, y: 0 },
      geometry: { type: "flat", elevation: 3 },
    });
    state = editorReducer(state, { type: "setFixture", coordinate: { x: 0, y: 0 }, fixture: { type: "switch", color: "yellow" } });
    state = editorReducer(state, { type: "setTool", tool: "box" });
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 0, y: 0 } });
    state = editorReducer(state, { type: "copySelectedCell" });
    state = editorReducer(state, { type: "select", coordinate: { x: 1, y: 0 } });
    state = editorReducer(state, { type: "pasteSelectedCell" });

    expect(state.document.cells["1,0"]).toEqual({ type: "flat", elevation: 3 });
    expect(state.document.fixtures["1,0"]).toEqual({ type: "switch", color: "yellow" });
    const destination = entitiesAt(state.document, { x: 1, y: 0 });
    expect(destination.map((entity) => entity.type)).toEqual(["player", "box"]);
    expect(destination.find((entity) => entity.type === "box")?.id).not.toBe("2");
    expect(new Set(Object.keys(state.document.entities)).size).toBe(Object.keys(state.document.entities).length);
  });

  it("erases entities before fixtures and terrain", () => {
    let state = initialEditorState(createLevel({ width: 1, height: 1, elevation: 2 }));
    state = editorReducer(state, { type: "setFixture", coordinate: { x: 0, y: 0 }, fixture: { type: "exit" } });
    state = editorReducer(state, { type: "setTool", tool: "eraser" });
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 0, y: 0 } });
    expect(state.document.entities).toEqual({});
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 0, y: 0 } });
    expect(state.document.fixtures).toEqual({});
    state = editorReducer(state, { type: "applyTool", coordinate: { x: 0, y: 0 } });
    expect(state.document.cells["0,0"]).toEqual({ type: "flat", elevation: 0 });
  });
});

describe("grid transforms", () => {
  it("clips out-of-bounds content when resizing and can be undone by reducer history", () => {
    const document = createLevel({ width: 3, height: 1 });
    document.fixtures["2,0"] = { type: "exit" };
    document.entities["2"] = { id: "2", type: "box", coordinate: { x: 2, y: 0 }, bottomHalfSteps: 0 };
    const resized = resizeDocument(document, 2, 1, "min-min", 0);
    expect(resized.fixtures).toEqual({});
    expect(resized.entities["2"]).toBeUndefined();
  });

  it("translates every authored coordinate and preserves axis choices", () => {
    const document = createLevel({ width: 2, height: 1 });
    document.fixtures["1,0"] = { type: "exit" };
    const translated = translateDocument(document, { x: -5, y: 9 }, "west", "south");
    expect(Object.keys(translated.cells)).toEqual(["-5,9", "-4,9"]);
    expect(translated.fixtures["-4,9"]).toEqual({ type: "exit" });
    expect(translated.entities["1"].coordinate).toEqual({ x: -5, y: 9 });
    expect(coordinateKey(translated.coordinateSystem.origin)).toBe("-5,9");
  });
});
