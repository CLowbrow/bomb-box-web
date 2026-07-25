import type {
  AxisX,
  AxisY,
  CellBundle,
  CellGeometry,
  Coordinate,
  Direction,
  DraftDocument,
  Entity,
  FixtureKind,
  LevelDefinitionV1,
  ResizeAnchor,
} from "./types";

export const MAX_BOARD_SIZE = 64;
const UINT64_MAX = 18_446_744_073_709_551_615n;

export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}

export function parseCoordinateKey(key: string): Coordinate {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

export function cloneGeometry(geometry: CellGeometry): CellGeometry {
  return geometry.type === "flat"
    ? { type: "flat", elevation: geometry.elevation }
    : {
        type: "ramp",
        lowDirection: geometry.lowDirection,
        lowElevation: geometry.lowElevation,
      };
}

export function cloneFixture(fixture: FixtureKind | undefined): FixtureKind | undefined {
  if (!fixture) return undefined;
  return fixture.type === "exit"
    ? { type: "exit" }
    : { type: fixture.type, color: fixture.color };
}

export function createLevel(options: {
  width?: number;
  height?: number;
  originX?: number;
  originY?: number;
  positiveX?: AxisX;
  positiveY?: AxisY;
  elevation?: number;
} = {}): DraftDocument {
  const width = clampInteger(options.width ?? 10, 1, MAX_BOARD_SIZE);
  const height = clampInteger(options.height ?? 8, 1, MAX_BOARD_SIZE);
  const origin = {
    x: toInteger(options.originX ?? 0),
    y: toInteger(options.originY ?? 0),
  };
  const cells: Record<string, CellGeometry> = {};
  for (let y = origin.y; y < origin.y + height; y += 1) {
    for (let x = origin.x; x < origin.x + width; x += 1) {
      cells[coordinateKey({ x, y })] = {
        type: "flat",
        elevation: toInteger(options.elevation ?? 0),
      };
    }
  }
  return {
    coordinateSystem: {
      origin,
      positiveX: options.positiveX ?? "east",
      positiveY: options.positiveY ?? "north",
    },
    width,
    height,
    cells,
    fixtures: {},
    entities: {
      "1": {
        id: "1",
        type: "player",
        coordinate: { ...origin },
        bottomHalfSteps: toInteger(options.elevation ?? 0) * 2,
      },
    },
  };
}

export function isCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== "object") return false;
  const coordinate = value as Coordinate;
  return Number.isInteger(coordinate.x) && Number.isInteger(coordinate.y);
}

export function isLevelDefinitionV1(value: unknown): value is LevelDefinitionV1 {
  if (!value || typeof value !== "object") return false;
  const level = value as LevelDefinitionV1;
  return level.format === "game-rules-level"
    && level.version === 1
    && Number.isInteger(level.width)
    && Number.isInteger(level.height)
    && level.width >= 1
    && level.width <= MAX_BOARD_SIZE
    && level.height >= 1
    && level.height <= MAX_BOARD_SIZE
    && !!level.coordinateSystem
    && isCoordinate(level.coordinateSystem.origin)
    && ["east", "west"].includes(level.coordinateSystem.positiveX)
    && ["north", "south"].includes(level.coordinateSystem.positiveY)
    && Array.isArray(level.cells)
    && Array.isArray(level.fixtures)
    && Array.isArray(level.entities);
}

export function fromLevelDefinition(level: LevelDefinitionV1): DraftDocument {
  const origin = { ...level.coordinateSystem.origin };
  const cells: Record<string, CellGeometry> = {};
  for (let y = origin.y; y < origin.y + level.height; y += 1) {
    for (let x = origin.x; x < origin.x + level.width; x += 1) {
      cells[coordinateKey({ x, y })] = { type: "flat", elevation: 0 };
    }
  }
  for (const cell of level.cells) {
    if (!inBoundsRaw(origin, level.width, level.height, cell.coordinate)) continue;
    cells[coordinateKey(cell.coordinate)] = cell.type === "flat"
      ? { type: "flat", elevation: cell.elevation }
      : {
          type: "ramp",
          lowDirection: cell.lowDirection,
          lowElevation: cell.lowElevation,
        };
  }
  const fixtures: Record<string, FixtureKind> = {};
  for (const fixture of level.fixtures) {
    fixtures[coordinateKey(fixture.coordinate)] = fixture.type === "exit"
      ? { type: "exit" }
      : { type: fixture.type, color: fixture.color };
  }
  const entities: Record<string, Entity> = {};
  for (const entity of level.entities) {
    entities[entity.id] = { ...entity, coordinate: { ...entity.coordinate } };
  }
  return {
    coordinateSystem: {
      origin,
      positiveX: level.coordinateSystem.positiveX,
      positiveY: level.coordinateSystem.positiveY,
    },
    width: level.width,
    height: level.height,
    cells,
    fixtures,
    entities,
  };
}

export function toLevelDefinition(document: DraftDocument): LevelDefinitionV1 {
  const cells = Object.entries(document.cells)
    .map(([key, geometry]) => ({ coordinate: parseCoordinateKey(key), geometry }))
    .sort((a, b) => spatialCompare(a.coordinate, b.coordinate))
    .map(({ coordinate, geometry }) => geometry.type === "flat"
      ? { coordinate, type: "flat" as const, elevation: geometry.elevation }
      : {
          coordinate,
          type: "ramp" as const,
          lowDirection: geometry.lowDirection,
          lowElevation: geometry.lowElevation,
        });
  const fixtures = Object.entries(document.fixtures)
    .map(([key, fixture]) => ({ coordinate: parseCoordinateKey(key), fixture }))
    .sort((a, b) => spatialCompare(a.coordinate, b.coordinate))
    .map(({ coordinate, fixture }) => fixture.type === "exit"
      ? { coordinate, type: "exit" as const }
      : { coordinate, type: fixture.type, color: fixture.color });
  const entities = Object.values(document.entities)
    .map((entity) => ({ ...entity, coordinate: { ...entity.coordinate } }))
    .sort((a, b) => spatialCompare(a.coordinate, b.coordinate)
      || a.bottomHalfSteps - b.bottomHalfSteps
      || compareIds(a.id, b.id));
  return {
    format: "game-rules-level",
    version: 1,
    coordinateSystem: {
      origin: { ...document.coordinateSystem.origin },
      positiveX: document.coordinateSystem.positiveX,
      positiveY: document.coordinateSystem.positiveY,
    },
    width: document.width,
    height: document.height,
    cells,
    fixtures,
    entities,
  };
}

export function serializeLevel(document: DraftDocument): string {
  return `${JSON.stringify(toLevelDefinition(document), null, 2)}\n`;
}

export function inBounds(document: DraftDocument, coordinate: Coordinate): boolean {
  return inBoundsRaw(
    document.coordinateSystem.origin,
    document.width,
    document.height,
    coordinate,
  );
}

function inBoundsRaw(origin: Coordinate, width: number, height: number, coordinate: Coordinate) {
  return coordinate.x >= origin.x
    && coordinate.x < origin.x + width
    && coordinate.y >= origin.y
    && coordinate.y < origin.y + height;
}

export function screenCoordinates(document: DraftDocument): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let row = 0; row < document.height; row += 1) {
    const yOffset = document.coordinateSystem.positiveY === "south"
      ? row
      : document.height - row - 1;
    for (let column = 0; column < document.width; column += 1) {
      const xOffset = document.coordinateSystem.positiveX === "east"
        ? column
        : document.width - column - 1;
      coordinates.push({
        x: document.coordinateSystem.origin.x + xOffset,
        y: document.coordinateSystem.origin.y + yOffset,
      });
    }
  }
  return coordinates;
}

export function entitiesAt(document: DraftDocument, coordinate: Coordinate): Entity[] {
  return Object.values(document.entities)
    .filter((entity) => coordinateKey(entity.coordinate) === coordinateKey(coordinate))
    .sort((a, b) => a.bottomHalfSteps - b.bottomHalfSteps || compareIds(a.id, b.id));
}

export function supportHalfSteps(geometry: CellGeometry): number {
  return geometry.type === "flat" ? geometry.elevation * 2 : geometry.lowElevation * 2 + 1;
}

export function stackTop(document: DraftDocument, coordinate: Coordinate, excludedId?: string): number {
  const geometry = document.cells[coordinateKey(coordinate)] ?? { type: "flat", elevation: 0 };
  return entitiesAt(document, coordinate)
    .filter((entity) => entity.id !== excludedId)
    .reduce((top, entity) => Math.max(top, entity.bottomHalfSteps + 2), supportHalfSteps(geometry));
}

export function nextEntityId(entities: Record<string, Entity>): string {
  const used = new Set(Object.keys(entities));
  for (let candidate = 1n; candidate <= UINT64_MAX; candidate += 1n) {
    const id = candidate.toString();
    if (!used.has(id)) return id;
  }
  throw new Error("No entity identifiers remain");
}

export function copyCell(document: DraftDocument, coordinate: Coordinate): CellBundle {
  const key = coordinateKey(coordinate);
  return {
    geometry: cloneGeometry(document.cells[key]),
    fixture: cloneFixture(document.fixtures[key]),
    entities: entitiesAt(document, coordinate).map((entity) => ({
      ...entity,
      coordinate: { ...entity.coordinate },
    })),
    copiedFrom: { ...coordinate },
  };
}

export function translateDocument(
  document: DraftDocument,
  nextOrigin: Coordinate,
  positiveX: AxisX,
  positiveY: AxisY,
): DraftDocument {
  const dx = nextOrigin.x - document.coordinateSystem.origin.x;
  const dy = nextOrigin.y - document.coordinateSystem.origin.y;
  const cells: Record<string, CellGeometry> = {};
  for (const [key, geometry] of Object.entries(document.cells)) {
    const coordinate = parseCoordinateKey(key);
    cells[coordinateKey({ x: coordinate.x + dx, y: coordinate.y + dy })] = geometry;
  }
  const fixtures: Record<string, FixtureKind> = {};
  for (const [key, fixture] of Object.entries(document.fixtures)) {
    const coordinate = parseCoordinateKey(key);
    fixtures[coordinateKey({ x: coordinate.x + dx, y: coordinate.y + dy })] = fixture;
  }
  const entities: Record<string, Entity> = {};
  for (const entity of Object.values(document.entities)) {
    entities[entity.id] = {
      ...entity,
      coordinate: { x: entity.coordinate.x + dx, y: entity.coordinate.y + dy },
    };
  }
  return {
    ...document,
    coordinateSystem: { origin: { ...nextOrigin }, positiveX, positiveY },
    cells,
    fixtures,
    entities,
  };
}

export function resizeDocument(
  document: DraftDocument,
  width: number,
  height: number,
  anchor: ResizeAnchor,
  elevation: number,
): DraftDocument {
  width = clampInteger(width, 1, MAX_BOARD_SIZE);
  height = clampInteger(height, 1, MAX_BOARD_SIZE);
  const [anchorX, anchorY] = anchor.split("-") as ["min" | "center" | "max", "min" | "center" | "max"];
  const xOffset = resizeOffset(document.width, width, anchorX);
  const yOffset = resizeOffset(document.height, height, anchorY);
  const origin = {
    x: document.coordinateSystem.origin.x + xOffset,
    y: document.coordinateSystem.origin.y + yOffset,
  };
  const cells: Record<string, CellGeometry> = {};
  for (let y = origin.y; y < origin.y + height; y += 1) {
    for (let x = origin.x; x < origin.x + width; x += 1) {
      const key = coordinateKey({ x, y });
      cells[key] = document.cells[key] ?? { type: "flat", elevation: toInteger(elevation) };
    }
  }
  const fixtures = Object.fromEntries(
    Object.entries(document.fixtures).filter(([key]) => inBoundsRaw(origin, width, height, parseCoordinateKey(key))),
  );
  const entities = Object.fromEntries(
    Object.entries(document.entities).filter(([, entity]) => inBoundsRaw(origin, width, height, entity.coordinate)),
  );
  return {
    ...document,
    coordinateSystem: { ...document.coordinateSystem, origin },
    width,
    height,
    cells,
    fixtures,
    entities,
  };
}

export function screenNeighbor(
  document: DraftDocument,
  coordinate: Coordinate,
  key: "ArrowUp" | "ArrowRight" | "ArrowDown" | "ArrowLeft",
): Coordinate | null {
  const xSign = document.coordinateSystem.positiveX === "east" ? 1 : -1;
  const ySign = document.coordinateSystem.positiveY === "south" ? 1 : -1;
  const delta = key === "ArrowLeft" ? { x: -xSign, y: 0 }
    : key === "ArrowRight" ? { x: xSign, y: 0 }
      : key === "ArrowUp" ? { x: 0, y: -ySign }
        : { x: 0, y: ySign };
  const next = { x: coordinate.x + delta.x, y: coordinate.y + delta.y };
  return inBounds(document, next) ? next : null;
}

export function directionArrow(direction: Direction): string {
  return ({ north: "↑", east: "→", south: "↓", west: "←" })[direction];
}

export function toInteger(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, toInteger(value)));
}

function resizeOffset(oldSize: number, newSize: number, anchor: "min" | "center" | "max") {
  if (anchor === "min") return 0;
  if (anchor === "max") return oldSize - newSize;
  return Math.floor((oldSize - newSize) / 2);
}

function spatialCompare(a: Coordinate, b: Coordinate): number {
  return a.y - b.y || a.x - b.x;
}

function compareIds(a: string, b: string): number {
  try {
    const first = BigInt(a);
    const second = BigInt(b);
    return first < second ? -1 : first > second ? 1 : 0;
  } catch {
    return a.localeCompare(b);
  }
}
