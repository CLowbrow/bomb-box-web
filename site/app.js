const statusElement = document.querySelector("#engine-status");
const boardElement = document.querySelector("#board");
const outcomeElement = document.querySelector("#outcome");
const resultElement = document.querySelector("#result");
const rewindButton = document.querySelector("#rewind");
const directionButtons = [...document.querySelectorAll("[data-direction]")];
const controls = [...directionButtons, rewindButton];

let engine;
let busy = true;

function setControlsDisabled(disabled) {
  for (const control of controls) {
    control.disabled = disabled;
  }
}

function coordinateKey({ x, y }) {
  return `${x},${y}`;
}

function orderedCells(state) {
  const { origin, positiveX, positiveY } = state.coordinateSystem;
  const xSign = positiveX === "east" ? 1 : -1;
  const ySign = positiveY === "south" ? 1 : -1;
  const cells = new Map(state.cells.map((cell) => [coordinateKey(cell.coordinate), cell]));
  const ordered = [];

  for (let row = 0; row < state.height; row += 1) {
    for (let column = 0; column < state.width; column += 1) {
      const coordinate = {
        x: origin.x + column * xSign,
        y: origin.y + row * ySign,
      };
      ordered.push(cells.get(coordinateKey(coordinate)));
    }
  }
  return ordered;
}

function render(state) {
  boardElement.replaceChildren();
  boardElement.style.setProperty("--columns", state.width);
  outcomeElement.textContent = state.outcome;

  const entities = new Map(
    state.entities.map((entity) => [coordinateKey(entity.coordinate), entity]),
  );

  for (const cell of orderedCells(state)) {
    const cellElement = document.createElement("div");
    const coordinate = coordinateKey(cell.coordinate);
    cellElement.className = `cell cell-${cell.type}`;
    cellElement.dataset.coordinate = coordinate;
    cellElement.setAttribute("role", "gridcell");
    cellElement.setAttribute("aria-label", `${cell.type} cell at ${coordinate}`);

    const entity = entities.get(coordinate);
    if (entity) {
      const entityElement = document.createElement("div");
      entityElement.className = `entity entity-${entity.type}`;
      entityElement.textContent = entity.type === "player" ? "P" : entity.type[0].toUpperCase();
      entityElement.title = `${entity.type} ${entity.id}`;
      cellElement.append(entityElement);
    }
    boardElement.append(cellElement);
  }
}

function describe(result) {
  if (result.operation === "move") {
    return result.accepted
      ? `Accepted ${result.direction}; ${result.events.length} event(s).`
      : `Rejected ${result.direction ?? "move"}: ${result.status}.`;
  }
  if (result.operation === "rewind") {
    return result.accepted ? "Restored the previous resolved state." : `Rewind rejected: ${result.status}.`;
  }
  return `${result.operation}: ${result.status}.`;
}

function applyResult(result) {
  if (result.state) {
    render(result.state);
  }
  resultElement.textContent = describe(result);
}

function runCommand(command) {
  if (!engine || busy) {
    return;
  }
  busy = true;
  setControlsDisabled(true);
  try {
    applyResult(command());
  } catch (error) {
    resultElement.textContent = `Command failed: ${error.message}`;
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

for (const button of directionButtons) {
  button.addEventListener("click", () => runCommand(() => engine.move(button.dataset.direction)));
}
rewindButton.addEventListener("click", () => runCommand(() => engine.rewind()));

const keyDirections = {
  ArrowUp: "north",
  w: "north",
  ArrowRight: "east",
  d: "east",
  ArrowDown: "south",
  s: "south",
  ArrowLeft: "west",
  a: "west",
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

setControlsDisabled(true);

try {
  const [{ default: createGameRulesModule }, levelResponse] = await Promise.all([
    import("./wasm/game_rules.mjs"),
    fetch("./levels/walkway.json"),
  ]);
  if (!levelResponse.ok) {
    throw new Error(`level request failed with ${levelResponse.status}`);
  }
  const level = await levelResponse.json();
  const module = await createGameRulesModule({
    locateFile: (file) => new URL(`./wasm/${file}`, import.meta.url).href,
  });
  engine = module.gameRules.createEngine();
  const loaded = engine.loadLevel(level);
  if (loaded.status !== "loaded" || !loaded.state) {
    throw new Error(`engine rejected level: ${loaded.status}`);
  }

  render(loaded.state);
  resultElement.textContent = "Level loaded. Waiting for input.";
  statusElement.dataset.state = "ready";
  statusElement.lastElementChild.textContent = `WASM API v${loaded.apiVersion} ready`;
  busy = false;
  setControlsDisabled(false);
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
