import { resolveLevelSource } from "./level-source.js";
import { createLatestMoveRunner, performCommand } from "./game/command-runner.js";
import { coordinateKey } from "./game/scene-model.js";
import { TICK_DURATION_MS, playEngineResult } from "./game/tick-playback.js";
import { createGameView } from "./game/three-view.js";

const statusElement = document.querySelector("#engine-status");
const boardElement = document.querySelector("#board");
const outcomeElement = document.querySelector("#outcome");
const resultElement = document.querySelector("#result");
const eventListElement = document.querySelector("#event-list");
const turnCountElement = document.querySelector("#turn-count");
const rewindButton = document.querySelector("#rewind");
const restartButton = document.querySelector("#restart");
const levelTitleElement = document.querySelector("#level-title");
const levelNameElement = document.querySelector("#level-name");
const levelLedeElement = document.querySelector("#level-lede");
const objectiveElement = document.querySelector("#objective");
const solutionElement = document.querySelector("#solution");
const directionButtons = [...document.querySelectorAll("[data-direction]")];
const directionArrows = Object.freeze({
  north: "↑",
  east: "→",
  south: "↓",
  west: "←",
});

let gameModule;
let level;
let engine;
let gameView;
let busy = true;
let outcome = "ongoing";
let turnCount = 0;
let entityTypes = new Map();
let moveRunner;

function updateControls() {
  const unavailable = busy || !engine;
  for (const button of directionButtons) {
    button.disabled = !engine
      || outcome !== "ongoing"
      || (busy && !moveRunner?.isRunning());
  }
  rewindButton.disabled = unavailable;
  restartButton.disabled = unavailable;
}

function updateStatePresentation(state) {
  outcome = state.outcome;
  outcomeElement.textContent = outcome;
  outcomeElement.dataset.outcome = outcome;
  turnCountElement.textContent = String(turnCount);
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

function showResultSummary(result) {
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

function animationDuration() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : TICK_DURATION_MS;
}

async function applyResult(result) {
  const nextTurnCount = result.operation === "move" && result.accepted
    ? turnCount + 1
    : result.operation === "rewind" && result.accepted
      ? Math.max(0, turnCount - 1)
      : result.operation === "loadLevel"
        ? 0
        : turnCount;

  eventListElement.replaceChildren();
  await playEngineResult(result, gameView, {
    durationMs: animationDuration(),
    onTickStart: (_tick, index, total) => {
      resultElement.textContent = `Resolving tick ${index + 1} of ${total}…`;
    },
    onState: (state) => updateStatePresentation(state),
  });
  turnCount = nextTurnCount;
  if (result.state) updateStatePresentation(result.state);
  showResultSummary(result);
}

async function runCommand(command) {
  if (!engine || busy) {
    return;
  }
  await performCommand(command, {
    setBusy: (value) => {
      busy = value;
      updateControls();
    },
    present: applyResult,
    onError: (error) => {
      resultElement.textContent = `Command failed: ${error.message}`;
    },
  });
}

moveRunner = createLatestMoveRunner(
  (direction) => runCommand(() => engine.move(direction)),
  {
    canMove: () => Boolean(engine)
      && outcome === "ongoing"
      && (!busy || moveRunner.isRunning()),
  },
);

function loadLevel() {
  const loaded = engine.loadLevel(level);
  if (loaded.status !== "loaded" || !loaded.state) {
    throw new Error(`engine rejected level: ${loaded.status}`);
  }
  entityTypes = new Map(level.entities.map((entity) => [entity.id, entity.type]));
  return loaded;
}

for (const button of directionButtons) {
  button.addEventListener("click", () => void moveRunner.request(button.dataset.direction));
}
rewindButton.addEventListener("click", () => void runCommand(() => engine.rewind()));
restartButton.addEventListener("click", () => void runCommand(() => loadLevel()));

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
    void moveRunner.request(direction);
    return;
  }
  if (event.key === "Backspace" || event.key.toLowerCase() === "z") {
    event.preventDefault();
    void runCommand(() => engine.rewind());
  }
});

updateControls();

try {
  const wasmModuleUrl = new URL("./wasm/game_rules.mjs", document.baseURI).href;
  const [{ default: createGameRulesModule }, levelSource] = await Promise.all([
    import(/* @vite-ignore */ wasmModuleUrl),
    resolveLevelSource(),
  ]);
  level = levelSource.level;
  if (levelSource.fromEditor) {
    document.title = `${levelSource.displayName} · Playtest`;
    levelTitleElement.textContent = "Editor playtest";
    levelNameElement.textContent = levelSource.displayName;
    levelLedeElement.textContent = "Playing the latest validated draft from the level editor.";
    objectiveElement.innerHTML = "Use the normal game controls to test this authored level. <strong>Restart</strong> reloads the same draft.";
    solutionElement.hidden = true;
  }
  gameModule = await createGameRulesModule({
    locateFile: (file) => new URL(`./wasm/${file}`, document.baseURI).href,
  });
  engine = gameModule.gameRules.createEngine();
  gameView = createGameView(boardElement);
  const loaded = loadLevel();
  await applyResult(loaded);

  resultElement.textContent = levelSource.fromEditor
    ? "Editor level loaded. Test it with the normal game controls."
    : "Level loaded. Find a route to the exit.";
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
    gameView?.dispose();
    engine?.destroy();
  }
});
