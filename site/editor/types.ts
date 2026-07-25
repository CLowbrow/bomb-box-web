export type Direction = "north" | "east" | "south" | "west";
export type AxisX = "east" | "west";
export type AxisY = "north" | "south";
export type FixtureColor = "red" | "green" | "blue" | "yellow";
export type EntityType = "player" | "box" | "barrel";

export interface Coordinate {
  x: number;
  y: number;
}

export interface CoordinateSystem {
  origin: Coordinate;
  positiveX: AxisX;
  positiveY: AxisY;
}

export interface FlatCell {
  coordinate: Coordinate;
  type: "flat";
  elevation: number;
}

export interface RampCell {
  coordinate: Coordinate;
  type: "ramp";
  lowDirection: Direction;
  lowElevation: number;
}

export type Cell = FlatCell | RampCell;
export type CellGeometry = Omit<FlatCell, "coordinate"> | Omit<RampCell, "coordinate">;

export interface ExitFixture {
  coordinate: Coordinate;
  type: "exit";
}

export interface ColoredFixture {
  coordinate: Coordinate;
  type: "switch" | "door";
  color: FixtureColor;
}

export type Fixture = ExitFixture | ColoredFixture;
export type FixtureKind = Omit<ExitFixture, "coordinate"> | Omit<ColoredFixture, "coordinate">;

export interface Entity {
  id: string;
  type: EntityType;
  coordinate: Coordinate;
  bottomHalfSteps: number;
}

export interface LevelDefinitionV1 {
  format: "game-rules-level";
  version: 1;
  coordinateSystem: CoordinateSystem;
  width: number;
  height: number;
  cells: Cell[];
  fixtures: Fixture[];
  entities: Entity[];
}

export interface DraftDocument {
  coordinateSystem: CoordinateSystem;
  width: number;
  height: number;
  cells: Record<string, CellGeometry>;
  fixtures: Record<string, FixtureKind>;
  entities: Record<string, Entity>;
}

export interface DraftEnvelopeV1 {
  envelopeVersion: 1;
  displayName: string;
  savedAt: string;
  level: LevelDefinitionV1;
}

export interface PlaytestEnvelopeV1 {
  envelopeVersion: 1;
  displayName: string;
  savedAt: string;
  level: LevelDefinitionV1;
}

export interface CellBundle {
  geometry: CellGeometry;
  fixture?: FixtureKind;
  entities: Entity[];
  copiedFrom: Coordinate;
}

export interface EngineValidationError {
  code: string;
  coordinate?: Coordinate;
  entityId?: string;
}

export interface EngineJsonError {
  code: string;
  byteOffset: number;
  path: string;
}

export interface EngineLoadResult {
  status: "loaded" | "invalid_json" | "invalid_level" | string;
  errors?: EngineValidationError[];
  error?: EngineJsonError;
  state?: unknown;
}

export interface ValidationState {
  status: "loading" | "pending" | "valid" | "invalid" | "error";
  issues: EngineValidationError[];
  message: string;
}

export type ToolKind =
  | "select"
  | "flat"
  | "ramp"
  | "player"
  | "box"
  | "barrel"
  | "exit"
  | "switch"
  | "door"
  | "eraser";

export interface ToolSettings {
  kind: ToolKind;
  elevation: number;
  lowElevation: number;
  lowDirection: Direction;
  color: FixtureColor;
}

export type ResizeAnchor =
  | "min-min"
  | "center-min"
  | "max-min"
  | "min-center"
  | "center-center"
  | "max-center"
  | "min-max"
  | "center-max"
  | "max-max";
