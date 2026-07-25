import {
  cloneFixture,
  cloneGeometry,
  coordinateKey,
  copyCell,
  createLevel,
  entitiesAt,
  inBounds,
  nextEntityId,
  resizeDocument,
  stackTop,
  translateDocument,
} from "./domain";
import type {
  AxisX,
  AxisY,
  CellGeometry,
  Coordinate,
  DraftDocument,
  Entity,
  EntityType,
  FixtureColor,
  FixtureKind,
  ResizeAnchor,
  ToolKind,
  ToolSettings,
} from "./types";

const HISTORY_LIMIT = 100;

export interface EditorState {
  past: DraftDocument[];
  document: DraftDocument;
  future: DraftDocument[];
  displayName: string;
  selected: Coordinate;
  selectedEntityId: string | null;
  tool: ToolSettings;
  clipboard: ReturnType<typeof copyCell> | null;
  zoom: number;
  notice: string;
}

export type EditorAction =
  | { type: "select"; coordinate: Coordinate; entityId?: string | null }
  | { type: "setTool"; tool: ToolKind }
  | { type: "setToolElevation"; elevation: number }
  | { type: "setToolLowElevation"; lowElevation: number }
  | { type: "setToolLowDirection"; lowDirection: ToolSettings["lowDirection"] }
  | { type: "setToolColor"; color: FixtureColor }
  | { type: "applyTool"; coordinate: Coordinate }
  | { type: "deleteSelected" }
  | { type: "copySelectedCell" }
  | { type: "pasteSelectedCell" }
  | { type: "setCellGeometry"; coordinate: Coordinate; geometry: CellGeometry }
  | { type: "setFixture"; coordinate: Coordinate; fixture?: FixtureKind }
  | { type: "updateEntity"; originalId: string; entity: Entity }
  | { type: "removeEntity"; id: string }
  | { type: "resize"; width: number; height: number; anchor: ResizeAnchor; elevation: number }
  | { type: "translate"; origin: Coordinate; positiveX: AxisX; positiveY: AxisY }
  | { type: "newDocument"; document: DraftDocument; displayName: string }
  | { type: "replaceDocument"; document: DraftDocument; displayName: string; notice?: string }
  | { type: "setDisplayName"; displayName: string }
  | { type: "setZoom"; zoom: number }
  | { type: "setNotice"; notice: string }
  | { type: "undo" }
  | { type: "redo" };

export function initialEditorState(document = createLevel(), displayName = "Untitled level"): EditorState {
  return {
    past: [],
    document,
    future: [],
    displayName,
    selected: { ...document.coordinateSystem.origin },
    selectedEntityId: null,
    tool: {
      kind: "select",
      elevation: 0,
      lowElevation: 0,
      lowDirection: "west",
      color: "red",
    },
    clipboard: null,
    zoom: 1,
    notice: "",
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selected: { ...action.coordinate },
        selectedEntityId: action.entityId ?? null,
      };
    case "setTool":
      return { ...state, tool: { ...state.tool, kind: action.tool } };
    case "setToolElevation":
      return { ...state, tool: { ...state.tool, elevation: Math.trunc(action.elevation) } };
    case "setToolLowElevation":
      return { ...state, tool: { ...state.tool, lowElevation: Math.trunc(action.lowElevation) } };
    case "setToolLowDirection":
      return { ...state, tool: { ...state.tool, lowDirection: action.lowDirection } };
    case "setToolColor":
      return { ...state, tool: { ...state.tool, color: action.color } };
    case "setDisplayName":
      return { ...state, displayName: action.displayName };
    case "setZoom":
      return { ...state, zoom: Math.min(1.6, Math.max(0.55, action.zoom)) };
    case "setNotice":
      return { ...state, notice: action.notice };
    case "copySelectedCell":
      return {
        ...state,
        clipboard: copyCell(state.document, state.selected),
        notice: `Copied cell ${coordinateKey(state.selected)}.`,
      };
    case "pasteSelectedCell": {
      if (!state.clipboard) return { ...state, notice: "Copy a cell before pasting." };
      const document = pasteBundle(state.document, state.selected, state.clipboard);
      return commit(state, document, "Pasted terrain, fixture, and stack.");
    }
    case "applyTool": {
      if (!inBounds(state.document, action.coordinate)) return state;
      if (state.tool.kind === "select") {
        return { ...state, selected: { ...action.coordinate }, selectedEntityId: null };
      }
      const document = applyTool(state.document, action.coordinate, state.tool);
      return commit(
        { ...state, selected: { ...action.coordinate }, selectedEntityId: null },
        document,
        `${toolLabel(state.tool.kind)} applied at ${coordinateKey(action.coordinate)}.`,
      );
    }
    case "deleteSelected": {
      const document = deleteAtSelection(state);
      return commit({ ...state, selectedEntityId: null }, document, "Removed selected element.");
    }
    case "setCellGeometry": {
      const key = coordinateKey(action.coordinate);
      return commit(state, {
        ...state.document,
        cells: { ...state.document.cells, [key]: cloneGeometry(action.geometry) },
      }, "Terrain updated.");
    }
    case "setFixture": {
      const key = coordinateKey(action.coordinate);
      const fixtures = { ...state.document.fixtures };
      if (action.fixture) fixtures[key] = cloneFixture(action.fixture)!;
      else delete fixtures[key];
      return commit(state, { ...state.document, fixtures }, "Fixture updated.");
    }
    case "updateEntity": {
      const entities = { ...state.document.entities };
      delete entities[action.originalId];
      entities[action.entity.id] = {
        ...action.entity,
        coordinate: { ...action.entity.coordinate },
        bottomHalfSteps: Math.trunc(action.entity.bottomHalfSteps),
      };
      return commit({ ...state, selectedEntityId: action.entity.id }, {
        ...state.document,
        entities,
      }, `Entity ${action.entity.id} updated.`);
    }
    case "removeEntity": {
      if (!state.document.entities[action.id]) return state;
      const entities = { ...state.document.entities };
      delete entities[action.id];
      return commit({ ...state, selectedEntityId: null }, {
        ...state.document,
        entities,
      }, `Entity ${action.id} removed.`);
    }
    case "resize": {
      const document = resizeDocument(
        state.document,
        action.width,
        action.height,
        action.anchor,
        action.elevation,
      );
      const selected = inBounds(document, state.selected)
        ? state.selected
        : { ...document.coordinateSystem.origin };
      return commit({ ...state, selected, selectedEntityId: null }, document, "Grid resized.");
    }
    case "translate": {
      const dx = action.origin.x - state.document.coordinateSystem.origin.x;
      const dy = action.origin.y - state.document.coordinateSystem.origin.y;
      const document = translateDocument(
        state.document,
        action.origin,
        action.positiveX,
        action.positiveY,
      );
      return commit({
        ...state,
        selected: { x: state.selected.x + dx, y: state.selected.y + dy },
      }, document, "Coordinate system updated.");
    }
    case "newDocument":
    case "replaceDocument":
      return {
        ...initialEditorState(action.document, action.displayName),
        notice: action.type === "replaceDocument" ? action.notice ?? "Level imported." : "New level created.",
      };
    case "undo": {
      const document = state.past.at(-1);
      if (!document) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        document,
        future: [state.document, ...state.future].slice(0, HISTORY_LIMIT),
        selectedEntityId: null,
        notice: "Undid last edit.",
      };
    }
    case "redo": {
      const [document, ...future] = state.future;
      if (!document) return state;
      return {
        ...state,
        past: [...state.past, state.document].slice(-HISTORY_LIMIT),
        document,
        future,
        selectedEntityId: null,
        notice: "Redid edit.",
      };
    }
    default:
      return state;
  }
}

function commit(state: EditorState, document: DraftDocument, notice: string): EditorState {
  if (document === state.document) return state;
  return {
    ...state,
    past: [...state.past, state.document].slice(-HISTORY_LIMIT),
    document,
    future: [],
    notice,
  };
}

function applyTool(
  document: DraftDocument,
  coordinate: Coordinate,
  tool: ToolSettings,
): DraftDocument {
  const key = coordinateKey(coordinate);
  if (tool.kind === "flat") {
    return { ...document, cells: {
      ...document.cells,
      [key]: { type: "flat", elevation: Math.trunc(tool.elevation) },
    } };
  }
  if (tool.kind === "ramp") {
    return { ...document, cells: {
      ...document.cells,
      [key]: {
        type: "ramp",
        lowDirection: tool.lowDirection,
        lowElevation: Math.trunc(tool.lowElevation),
      },
    } };
  }
  if (["player", "box", "barrel"].includes(tool.kind)) {
    return placeEntity(document, coordinate, tool.kind as EntityType);
  }
  if (tool.kind === "exit") {
    return { ...document, fixtures: { ...document.fixtures, [key]: { type: "exit" } } };
  }
  if (tool.kind === "switch" || tool.kind === "door") {
    return { ...document, fixtures: {
      ...document.fixtures,
      [key]: { type: tool.kind, color: tool.color },
    } };
  }
  if (tool.kind === "eraser") {
    return eraseCell(document, coordinate);
  }
  return document;
}

function placeEntity(document: DraftDocument, coordinate: Coordinate, type: EntityType): DraftDocument {
  const entities = { ...document.entities };
  if (type === "player") {
    const players = Object.values(entities).filter((entity) => entity.type === "player");
    const player = players[0];
    const id = player?.id ?? nextEntityId(entities);
    for (const existingPlayer of players) delete entities[existingPlayer.id];
    const documentWithoutPlayers = { ...document, entities };
    entities[id] = {
      id,
      type: "player",
      coordinate: { ...coordinate },
      bottomHalfSteps: stackTop(documentWithoutPlayers, coordinate),
    };
  } else {
    const id = nextEntityId(entities);
    entities[id] = {
      id,
      type,
      coordinate: { ...coordinate },
      bottomHalfSteps: stackTop(document, coordinate),
    };
  }
  return { ...document, entities };
}

function eraseCell(document: DraftDocument, coordinate: Coordinate): DraftDocument {
  const key = coordinateKey(coordinate);
  const column = entitiesAt(document, coordinate);
  if (column.length) {
    const entities = { ...document.entities };
    delete entities[column.at(-1)!.id];
    return { ...document, entities };
  }
  if (document.fixtures[key]) {
    const fixtures = { ...document.fixtures };
    delete fixtures[key];
    return { ...document, fixtures };
  }
  return { ...document, cells: { ...document.cells, [key]: { type: "flat", elevation: 0 } } };
}

function deleteAtSelection(state: EditorState): DraftDocument {
  if (state.selectedEntityId && state.document.entities[state.selectedEntityId]) {
    const entities = { ...state.document.entities };
    delete entities[state.selectedEntityId];
    return { ...state.document, entities };
  }
  return eraseCell(state.document, state.selected);
}

function pasteBundle(
  document: DraftDocument,
  coordinate: Coordinate,
  bundle: NonNullable<EditorState["clipboard"]>,
): DraftDocument {
  const key = coordinateKey(coordinate);
  const cells = { ...document.cells, [key]: cloneGeometry(bundle.geometry) };
  const fixtures = { ...document.fixtures };
  if (bundle.fixture) fixtures[key] = cloneFixture(bundle.fixture)!;
  else delete fixtures[key];

  const destinationIds = new Set(entitiesAt(document, coordinate).map((entity) => entity.id));
  const entities = Object.fromEntries(
    Object.entries(document.entities).filter(([id]) => !destinationIds.has(id)),
  );
  for (const source of bundle.entities) {
    if (source.type === "player") {
      const existing = Object.values(entities).find((entity) => entity.type === "player");
      const id = existing?.id ?? nextEntityId(entities);
      if (existing) delete entities[existing.id];
      entities[id] = { ...source, id, coordinate: { ...coordinate } };
    } else {
      const id = nextEntityId(entities);
      entities[id] = { ...source, id, coordinate: { ...coordinate } };
    }
  }
  return { ...document, cells, fixtures, entities };
}

function toolLabel(tool: ToolKind): string {
  return ({
    select: "Selection",
    flat: "Flat terrain",
    ramp: "Ramp",
    player: "Player",
    box: "Box",
    barrel: "Barrel",
    exit: "Exit",
    switch: "Switch",
    door: "Door",
    eraser: "Eraser",
  })[tool];
}
