export const SCENE_UNITS = Object.freeze({
  grid: 1,
  levelHeight: 0.65,
  halfStep: 0.325,
  floorSize: 0.95,
  floorGap: 0.025,
  rampOverlap: 0.018,
  boxSize: 0.74,
  barrelDiameter: 0.64,
  playerHeight: 0.9,
  doorHeight: 1.3,
});

export const ENTITY_HEIGHTS = Object.freeze({
  box: SCENE_UNITS.levelHeight,
  barrel: SCENE_UNITS.levelHeight,
  player: SCENE_UNITS.playerHeight,
});

export function coordinateKey({ x, y }) {
  return `${x},${y}`;
}

export function coordinateToWorld(coordinate, world) {
  const authoredX = coordinate.x - world.coordinateSystem.origin.x;
  const authoredY = coordinate.y - world.coordinateSystem.origin.y;
  const east = world.coordinateSystem.positiveX === "east"
    ? authoredX
    : world.width - authoredX - 1;
  const north = world.coordinateSystem.positiveY === "north"
    ? authoredY
    : world.height - authoredY - 1;

  return {
    x: (east - (world.width - 1) / 2) * SCENE_UNITS.grid,
    z: -(north - (world.height - 1) / 2) * SCENE_UNITS.grid,
  };
}

export function entityBottomY(bottomHalfSteps) {
  return bottomHalfSteps * SCENE_UNITS.halfStep;
}

export function entityTransform(entity, world) {
  const horizontal = coordinateToWorld(entity.coordinate, world);
  return {
    ...horizontal,
    y: entityBottomY(entity.bottomHalfSteps),
    height: ENTITY_HEIGHTS[entity.type] ?? SCENE_UNITS.levelHeight,
  };
}

export function cellSurfaceRange(cell) {
  if (cell.type === "ramp") {
    return {
      low: cell.lowElevation * SCENE_UNITS.levelHeight,
      high: (cell.lowElevation + 1) * SCENE_UNITS.levelHeight,
    };
  }
  const height = cell.elevation * SCENE_UNITS.levelHeight;
  return { low: height, high: height };
}

export function terrainBaselineElevation(cells) {
  const lowestSurface = cells.reduce((lowest, cell) => Math.min(
    lowest,
    cell.type === "ramp" ? cell.lowElevation : cell.elevation,
  ), 0);
  return lowestSurface - 0.5;
}

export function terrainColumnSegments(surfaceElevation, baselineElevation) {
  const segments = [];
  let bottom = baselineElevation;

  while (bottom < surfaceElevation) {
    const boundary = Number.isInteger(bottom) ? bottom + 1 : Math.ceil(bottom);
    const candidateTop = Math.min(surfaceElevation, boundary);
    const top = Object.is(candidateTop, -0) ? 0 : candidateTop;
    const gap = segments.length ? SCENE_UNITS.floorGap : 0;
    segments.push({
      bottom: bottom * SCENE_UNITS.levelHeight + gap,
      top: top * SCENE_UNITS.levelHeight,
    });
    bottom = top;
  }
  return segments;
}

export function rampCornerHeights(lowDirection) {
  const high = SCENE_UNITS.levelHeight;
  const corners = [
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ];

  return corners.map(({ x, z }) => {
    if (lowDirection === "north") return z < 0 ? 0 : high;
    if (lowDirection === "south") return z > 0 ? 0 : high;
    if (lowDirection === "east") return x > 0 ? 0 : high;
    return x < 0 ? 0 : high;
  });
}

export function dynamicStateFromFull(state) {
  return {
    entities: state.entities,
    armedBarrelIds: state.armedBarrelIds,
    activeSwitchColors: state.activeSwitchColors,
    openDoorCoordinates: state.openDoorCoordinates,
    outcome: state.outcome,
  };
}

export function describeDynamicState(state, world) {
  const counts = { player: 0, box: 0, barrel: 0 };
  for (const entity of state.entities ?? []) {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  }
  return [
    `${world.width} by ${world.height} game board.`,
    `${counts.player} player, ${counts.box} boxes, and ${counts.barrel} barrels.`,
    `Outcome ${state.outcome}.`,
  ].join(" ");
}
