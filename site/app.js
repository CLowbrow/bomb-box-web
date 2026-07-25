const statusElement = document.querySelector("#engine-status");
const boardElement = document.querySelector("#board");
const outcomeElement = document.querySelector("#outcome");
const resultElement = document.querySelector("#result");
const eventListElement = document.querySelector("#event-list");
const turnCountElement = document.querySelector("#turn-count");
const rewindButton = document.querySelector("#rewind");
const restartButton = document.querySelector("#restart");
const directionButtons = [...document.querySelectorAll("[data-direction]")];
const directionArrows = Object.freeze({
  north: "↑",
  east: "→",
  south: "↓",
  west: "←",
});
const rampArrows = Object.freeze({
  north: "↕",
  east: "↔",
  south: "↕",
  west: "↔",
});
const entityGlyphs = Object.freeze({
  player: "P",
  box: "■",
  barrel: "●",
});

let gameModule;
let level;
let engine;
let busy = true;
let outcome = "ongoing";
let turnCount = 0;
let entityTypes = new Map();

function coordinateKey({ x, y }) {
  return `${x},${y}`;
}

function updateControls() {
  const unavailable = busy || !engine;
  for (const button of directionButtons) {
    button.disabled = unavailable || outcome !== "ongoing";
  }
  rewindButton.disabled = unavailable;
  restartButton.disabled = unavailable;
}

function orderedCells(state) {
  const { origin, positiveX, positiveY } = state.coordinateSystem;
  const cells = new Map(state.cells.map((cell) => [coordinateKey(cell.coordinate), cell]));
  const ordered = [];

  for (let screenRow = 0; screenRow < state.height; screenRow += 1) {
    const authoredRow = positiveY === "south" ? screenRow : state.height - screenRow - 1;
    for (let screenColumn = 0; screenColumn < state.width; screenColumn += 1) {
      const authoredColumn = positiveX === "east"
        ? screenColumn
        : state.width - screenColumn - 1;
      const coordinate = {
        x: origin.x + authoredColumn,
        y: origin.y + authoredRow,
      };
      ordered.push(cells.get(coordinateKey(coordinate)));
    }
  }
  return ordered;
}

function groupByCoordinate(values) {
  const groups = new Map();
  for (const value of values) {
    const key = coordinateKey(value.coordinate);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function renderFixture(cellElement, fixture, state) {
  if (!fixture) {
    return;
  }

  const fixtureElement = document.createElement("div");
  fixtureElement.className = `fixture fixture-${fixture.type}`;
  let description = "exit teleporter";

  if (fixture.type === "switch") {
    const active = state.activeSwitchColors.includes(fixture.color);
    fixtureElement.classList.toggle("is-active", active);
    fixtureElement.classList.add(`fixture-${fixture.color}`);
    fixtureElement.textContent = active ? "ON" : "SW";
    description = `${fixture.color} switch, ${active ? "active" : "inactive"}`;
  } else if (fixture.type === "door") {
    const open = state.openDoorCoordinates.some(
      (coordinate) => coordinateKey(coordinate) === coordinateKey(fixture.coordinate),
    );
    fixtureElement.classList.toggle("is-open", open);
    fixtureElement.classList.add(`fixture-${fixture.color}`);
    fixtureElement.textContent = open ? "OPEN" : "DOOR";
    description = `${fixture.color} door, ${open ? "open" : "closed"}`;
  } else {
    fixtureElement.textContent = "EXIT";
  }

  fixtureElement.setAttribute("aria-label", description);
  fixtureElement.title = description;
  cellElement.append(fixtureElement);
}

function renderEntities(cellElement, entities, state) {
  if (!entities?.length) {
    return;
  }

  const stackElement = document.createElement("div");
  stackElement.className = "entity-stack";
  const armedIds = new Set(state.armedBarrelIds);

  for (const entity of [...entities].sort((a, b) => a.bottomHalfSteps - b.bottomHalfSteps)) {
    const entityElement = document.createElement("div");
    const armed = entity.type === "barrel" && armedIds.has(entity.id);
    entityElement.className = `entity entity-${entity.type}${armed ? " is-armed" : ""}`;
    entityElement.textContent = entityGlyphs[entity.type] ?? "?";
    entityElement.setAttribute("aria-label", `${armed ? "armed " : ""}${entity.type} ${entity.id}`);
    entityElement.title = `${armed ? "Armed " : ""}${entity.type} ${entity.id} at height ${entity.bottomHalfSteps}/2`;
    stackElement.append(entityElement);
  }
  cellElement.append(stackElement);
}

function render(state) {
  boardElement.replaceChildren();
  boardElement.style.setProperty("--columns", state.width);
  outcome = state.outcome;
  outcomeElement.textContent = outcome;
  outcomeElement.dataset.outcome = outcome;
  turnCountElement.textContent = String(turnCount);

  const entities = groupByCoordinate(state.entities);
  const fixtures = new Map(
    state.fixtures.map((fixture) => [coordinateKey(fixture.coordinate), fixture]),
  );

  for (const cell of orderedCells(state)) {
    const cellElement = document.createElement("div");
    const coordinate = coordinateKey(cell.coordinate);
    const elevation = cell.type === "flat" ? cell.elevation : cell.lowElevation + 0.5;
    cellElement.className = `cell cell-${cell.type}`;
    cellElement.dataset.coordinate = coordinate;
    cellElement.dataset.elevation = elevation;
    cellElement.setAttribute("role", "gridcell");
    cellElement.setAttribute(
      "aria-label",
      `${cell.type} cell at ${coordinate}, elevation ${elevation}`,
    );

    if (cell.type === "ramp") {
      const rampDirectionElement = document.createElement("span");
      rampDirectionElement.className = "ramp-direction";
      rampDirectionElement.textContent = rampArrows[cell.lowDirection];
      rampDirectionElement.setAttribute("aria-hidden", "true");
      cellElement.dataset.lowDirection = cell.lowDirection;
      cellElement.title = `Bidirectional ramp; descends ${cell.lowDirection}; center elevation z${elevation}`;
      cellElement.append(rampDirectionElement);
    }

    const elevationElement = document.createElement("span");
    elevationElement.className = "elevation";
    elevationElement.textContent = `z${elevation}`;
    elevationElement.setAttribute("aria-hidden", "true");
    cellElement.append(elevationElement);

    renderFixture(cellElement, fixtures.get(coordinate), state);
    renderEntities(cellElement, entities.get(coordinate), state);
    boardElement.append(cellElement);
  }
  updateControls();
}

function entityName(id) {
  return entityTypes.get(id) ?? `entity ${id}`;
}

function describeEvent(event) {
  if (event.type === "entityMoved") {
    const movement = event.cause === "player" ? "moved" : event.cause;
    return `${entityName(event.entityId)} ${movement} to ${coordinateKey(event.to)}`;
  }
  if (event.type === "barrelArmed") {
    return `barrel ${event.entityId} armed`;
  }
  if (event.type === "barrelExploded") {
    return `barrel ${event.entityId} exploded at ${coordinateKey(event.coordinate)}`;
  }
  if (event.type === "switchChanged") {
    return `${event.color} switch ${event.active ? "activated" : "released"}`;
  }
  if (event.type === "doorOpened") {
    return `${event.color} door opened`;
  }
  if (event.type === "doorClosed") {
    return `${event.color} door closed`;
  }
  if (event.type === "levelWon") {
    return "exit reached — level won";
  }
  if (event.type === "levelLost") {
    return "player lost";
  }
  if (event.type === "stateRewound") {
    return "previous turn restored";
  }
  return event.type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function resultEvents(result) {
  if (result.ticks?.length) {
    return result.ticks.flatMap((tick) =>
      tick.events.map((event) => ({ tick: tick.index, event })),
    );
  }
  return (result.events ?? []).map((event) => ({ tick: null, event }));
}

function describeResult(result, events) {
  if (result.operation === "move") {
    if (!result.accepted) {
      return `Blocked ${result.direction ?? "move"}: ${result.status.replaceAll("_", " ")}.`;
    }
    const extraTicks = Math.max(0, (result.ticks?.length ?? 1) - 1);
    return `${directionArrows[result.direction]} ${result.direction} accepted${extraTicks ? ` with ${extraTicks} automatic tick${extraTicks === 1 ? "" : "s"}` : ""}.`;
  }
  if (result.operation === "rewind") {
    return result.accepted ? "Rewound one accepted turn." : "Nothing left to rewind.";
  }
  if (result.operation === "loadLevel") {
    return "Level restarted. History cleared.";
  }
  return `${result.operation}: ${result.status}.`;
}

function applyResult(result) {
  if (result.operation === "move" && result.accepted) {
    turnCount += 1;
  } else if (result.operation === "rewind" && result.accepted) {
    turnCount = Math.max(0, turnCount - 1);
  }

  if (result.state) {
    render(result.state);
  }

  const events = resultEvents(result);
  resultElement.textContent = describeResult(result, events);
  eventListElement.replaceChildren();
  if (events.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No secondary rules events.";
    item.className = "muted-event";
    eventListElement.append(item);
  } else {
    for (const { tick, event } of events) {
      const item = document.createElement("li");
      item.textContent = `${tick === null ? "" : `t${tick} · `}${describeEvent(event)}`;
      eventListElement.append(item);
    }
  }
}

function runCommand(command) {
  if (!engine || busy) {
    return;
  }
  busy = true;
  updateControls();
  try {
    applyResult(command());
  } catch (error) {
    resultElement.textContent = `Command failed: ${error.message}`;
  } finally {
    busy = false;
    updateControls();
  }
}

function loadLevel({ announce = true } = {}) {
  const loaded = engine.loadLevel(level);
  if (loaded.status !== "loaded" || !loaded.state) {
    throw new Error(`engine rejected level: ${loaded.status}`);
  }
  turnCount = 0;
  entityTypes = new Map(level.entities.map((entity) => [entity.id, entity.type]));
  render(loaded.state);
  eventListElement.replaceChildren();
  if (announce) {
    resultElement.textContent = "Level restarted. History cleared.";
  }
  return loaded;
}

for (const button of directionButtons) {
  button.addEventListener("click", () => runCommand(() => engine.move(button.dataset.direction)));
}
rewindButton.addEventListener("click", () => runCommand(() => engine.rewind()));
restartButton.addEventListener("click", () => runCommand(() => loadLevel()));

const keyDirections = {
  ArrowUp: "north",
  w: "north",
  W: "north",
  ArrowRight: "east",
  d: "east",
  D: "east",
  ArrowDown: "south",
  s: "south",
  S: "south",
  ArrowLeft: "west",
  a: "west",
  A: "west",
};

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  const direction = keyDirections[event.key];
  if (direction) {
    event.preventDefault();
    runCommand(() => engine.move(direction));
    return;
  }
  if (event.key === "Backspace" || event.key.toLowerCase() === "z") {
    event.preventDefault();
    runCommand(() => engine.rewind());
  }
});

updateControls();

try {
  const [{ default: createGameRulesModule }, levelResponse] = await Promise.all([
    import("./wasm/game_rules.mjs"),
    fetch("./levels/hardening-run.json"),
  ]);
  if (!levelResponse.ok) {
    throw new Error(`level request failed with ${levelResponse.status}`);
  }
  level = await levelResponse.json();
  gameModule = await createGameRulesModule({
    locateFile: (file) => new URL(`./wasm/${file}`, import.meta.url).href,
  });
  engine = gameModule.gameRules.createEngine();
  const loaded = loadLevel({ announce: false });

  resultElement.textContent = "Level loaded. Find a route to the exit.";
  statusElement.dataset.state = "ready";
  statusElement.lastElementChild.textContent = `WASM API v${loaded.apiVersion} ready`;
  busy = false;
  updateControls();
} catch (error) {
  statusElement.dataset.state = "error";
  statusElement.lastElementChild.textContent = "Engine failed to load";
  resultElement.textContent = error.message;
}

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    engine?.destroy();
  }
});
