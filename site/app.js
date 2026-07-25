import { cannedLevels, findCannedLevel, resolveLevelSource } from "./level-source.js";
import { createLatestMoveRunner, performCommand } from "./game/command-runner.js";
import { TICK_DURATION_MS } from "./game/config.js";
import { coordinateKey } from "./game/scene-model.js";
import { playEngineResult } from "./game/tick-playback.js";
import { createGameView } from "./game/three-view.js";

const statusElement = document.querySelector("#engine-status");
const boardElement = document.querySelector("#board");
const outcomeElement = document.querySelector("#outcome");
const turnCountElement = document.querySelector("#turn-count");
const rewindButton = document.querySelector("#rewind");
const restartButton = document.querySelector("#restart");
const levelNameElement = document.querySelector("#level-name");
const levelListElement = document.querySelector("#level-list");
const howToPlayElement = document.querySelector("#how-to-play");
const directionButtons = [...document.querySelectorAll("[data-direction]")];
const directionArrows = Object.freeze({
  north: "↑",
  east: "→",
  south: "↓",
  west: "←",
});

let level;
let currentLevelId = null;
let engine;
let gameView;
let busy = true;
let outcome = "ongoing";
let turnCount = 0;
let entityTypes = new Map();
let moveRunner;

function setStatus(state, message) {
  statusElement.dataset.state = state;
  statusElement.lastElementChild.textContent = message;
}

function updateControls() {
  const unavailable = busy || !engine;
  for (const button of directionButtons) {
    button.disabled = !engine
      || outcome !== "ongoing"
      || (busy && !moveRunner?.isRunning());
  }
  rewindButton.disabled = unavailable;
  restartButton.disabled = unavailable;
  levelListElement.dataset.busy = String(unavailable);
}

function updateStatePresentation(state) {
  outcome = state.outcome;
  outcomeElement.textContent = outcome;
  outcomeElement.dataset.outcome = outcome;
  turnCountElement.textContent = String(turnCount);
  updateControls();
}

function setCurrentLevel({ id, displayName }) {
  currentLevelId = id;
  levelNameElement.textContent = displayName;
  document.title = `${displayName} · Bomb Box`;
  for (const link of levelListElement.querySelectorAll("[data-level-id]")) {
    if (link.dataset.levelId === id) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function entityName(id) {
  return entityTypes.get(id) ?? `entity ${id}`;
}

function describeEvent(event) {
  if (event.type === "entityMoved") {
    const movement = event.cause === "player" ? "moved" : event.cause;
    return `${entityName(event.entityId)} ${movement} to ${coordinateKey(event.to)}`;
  }
  if (event.type === "barrelArmed") return `barrel ${event.entityId} armed`;
  if (event.type === "barrelExploded") {
    return `barrel ${event.entityId} exploded at ${coordinateKey(event.coordinate)}`;
  }
  if (event.type === "switchChanged") {
    return `${event.color} switch ${event.active ? "activated" : "released"}`;
  }
  if (event.type === "doorOpened") return `${event.color} door opened`;
  if (event.type === "doorClosed") return `${event.color} door closed`;
  if (event.type === "levelWon") return "exit reached — level won";
  if (event.type === "levelLost") return "player lost";
  if (event.type === "stateRewound") return "previous turn restored";
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

function describeResult(result) {
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
  if (result.operation === "loadLevel") return "Level loaded. History cleared.";
  return `${result.operation}: ${result.status}.`;
}

function logResult(result) {
  const label = result.operation === "move" && result.accepted
    ? `Turn ${turnCount}`
    : result.operation === "rewind"
      ? "Rewind"
      : "Level";
  console.groupCollapsed(`[Bomb Box] ${label} · ${describeResult(result)}`);
  console.log({
    operation: result.operation,
    status: result.status,
    accepted: result.accepted,
    direction: result.direction,
    outcome: result.state?.outcome,
  });
  for (const { tick, event } of resultEvents(result)) {
    console.log(`${tick === null ? "event" : `tick ${tick}`} · ${describeEvent(event)}`, event);
  }
  console.groupEnd();
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

  await playEngineResult(result, gameView, {
    durationMs: animationDuration(),
    onState: (state) => updateStatePresentation(state),
  });
  turnCount = nextTurnCount;
  if (result.state) updateStatePresentation(result.state);
  logResult(result);
}

async function runCommand(command) {
  if (!engine || busy) return;
  await performCommand(command, {
    setBusy: (value) => {
      busy = value;
      updateControls();
    },
    present: applyResult,
    onError: (error) => {
      setStatus("error", "Command failed");
      console.error("[Bomb Box] Command failed", error);
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

function loadLevel(nextLevel = level) {
  const loaded = engine.loadLevel(nextLevel);
  if (loaded.status !== "loaded" || !loaded.state) {
    throw new Error(`engine rejected level: ${loaded.status}`);
  }
  level = nextLevel;
  entityTypes = new Map(level.entities.map((entity) => [entity.id, entity.type]));
  return loaded;
}

async function switchToCannedLevel(entry, { updateHistory = true } = {}) {
  if (!engine || busy || !entry) return;
  busy = true;
  updateControls();
  try {
    const loaded = loadLevel(entry.level);
    await applyResult(loaded);
    setCurrentLevel(entry);
    setStatus("ready", "Ready");
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("level", entry.id);
      history.pushState({ level: entry.id }, "", url);
    }
  } catch (error) {
    setStatus("error", "Level failed");
    console.error(`[Bomb Box] Could not load ${entry.displayName}`, error);
  } finally {
    busy = false;
    updateControls();
  }
}

for (const entry of cannedLevels) {
  const link = document.createElement("a");
  link.className = "level-link";
  link.dataset.levelId = entry.id;
  link.href = `./?level=${encodeURIComponent(entry.id)}`;
  link.textContent = entry.displayName;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void switchToCannedLevel(entry);
  });
  levelListElement.append(link);
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
  if (event.repeat || howToPlayElement.matches(":popover-open")) return;
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

window.addEventListener("popstate", () => {
  const id = new URLSearchParams(window.location.search).get("level");
  const entry = findCannedLevel(id) ?? cannedLevels[0];
  if (entry?.id !== currentLevelId) void switchToCannedLevel(entry, { updateHistory: false });
});

updateControls();

try {
  const wasmModuleUrl = new URL("./wasm/game_rules.mjs", document.baseURI).href;
  const [{ default: createGameRulesModule }, levelSource] = await Promise.all([
    import(/* @vite-ignore */ wasmModuleUrl),
    resolveLevelSource(),
  ]);
  const gameModule = await createGameRulesModule({
    locateFile: (file) => new URL(`./wasm/${file}`, document.baseURI).href,
  });
  engine = gameModule.gameRules.createEngine();
  gameView = createGameView(boardElement);
  const loaded = loadLevel(levelSource.level);
  setCurrentLevel(levelSource);
  await applyResult(loaded);

  setStatus("ready", "Ready");
  busy = false;
  updateControls();
} catch (error) {
  setStatus("error", "Engine failed");
  console.error("[Bomb Box] Engine failed to load", error);
}

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    gameView?.dispose();
    engine?.destroy();
  }
});
