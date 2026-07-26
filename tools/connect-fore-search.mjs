#!/usr/bin/env node

// Offline design helper for site/levels/canned/04-connect-fore.json.
//
// This models the single interesting row of the level so that candidate stacks
// and barrel-drop orders can be searched much faster than replaying the whole
// level in the browser. A found candidate must still be verified with the real
// engine before it is written to the canned-level file.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const levelPath = resolve(projectRoot, "site/levels/canned/04-connect-fore.json");
const wasmPath = resolve(projectRoot, "dist/wasm/game_rules.mjs");

const DROP_COLUMNS = [1, 2, 3, 4, 5, 6, 7];
const BRIDGE_COLUMNS = [2, 3, 4, 5, 6, 7];
const MINIMUM_DROPS = 5;
const FLOOR = [6, 1, 0, 0, 0, 0, 0, 0, 1, 0];
const TYPE = Object.freeze({ box: "X", barrel: "O" });

function cloneState(state) {
  return {
    nextId: state.nextId,
    columns: state.columns.map((column) => column.map((entity) => ({ ...entity }))),
  };
}

function stabilize(state) {
  for (let x = 0; x < state.columns.length; x += 1) {
    state.columns[x].sort((left, right) => left.height - right.height || left.id - right.id);
    for (let index = 0; index < state.columns[x].length; index += 1) {
      state.columns[x][index].height = FLOOR[x] + index;
    }
  }
}

function entityAt(state, x, height) {
  return state.columns[x]?.find((entity) => entity.height === height) ?? null;
}

function removeEntity(state, id) {
  for (const column of state.columns) {
    const index = column.findIndex((entity) => entity.id === id);
    if (index !== -1) return column.splice(index, 1)[0];
  }
  return null;
}

function explodeWaves(state, initialArmed) {
  let armed = new Set(initialArmed);
  let explosions = 0;

  while (armed.size > 0) {
    const sources = [];
    for (let x = 0; x < state.columns.length; x += 1) {
      for (const entity of state.columns[x]) {
        if (armed.has(entity.id)) sources.push({ ...entity, x });
      }
    }
    if (sources.length === 0) break;
    explosions += sources.length;

    const sourceIds = new Set(sources.map(({ id }) => id));
    const targets = new Map();
    const addTarget = (entity, x) => {
      if (!targets.has(entity.id)) {
        targets.set(entity.id, { entity: { ...entity }, x, impulses: new Set(), armed: false });
      }
      return targets.get(entity.id);
    };

    for (const source of sources) {
      for (const delta of [-1, 1]) {
        const sameColumn = entityAt(state, source.x, source.height + delta);
        if (sameColumn?.type === TYPE.barrel && !sourceIds.has(sameColumn.id)) {
          addTarget(sameColumn, source.x).armed = true;
        }
      }

      for (const delta of [-1, 1]) {
        const targetX = source.x + delta;
        const target = entityAt(state, targetX, source.height);
        if (!target || sourceIds.has(target.id)) continue;
        const entry = addTarget(target, targetX);
        entry.impulses.add(delta);
        if (target.type === TYPE.barrel) entry.armed = true;
      }
    }

    const moves = [];
    for (const target of targets.values()) {
      if (target.impulses.size !== 1) continue;
      const [delta] = target.impulses;
      const destinationX = target.x + delta;
      if (destinationX < 0 || destinationX >= state.columns.length) continue;
      if (FLOOR[destinationX] > target.entity.height) continue;
      if (entityAt(state, destinationX, target.entity.height)) continue;
      moves.push({ ...target, destinationX });
    }

    const conflicts = new Set();
    for (let left = 0; left < moves.length; left += 1) {
      for (let right = left + 1; right < moves.length; right += 1) {
        if (moves[left].destinationX === moves[right].destinationX
            && moves[left].entity.height === moves[right].entity.height) {
          conflicts.add(moves[left].entity.id);
          conflicts.add(moves[right].entity.id);
        }
      }
    }

    for (const { id } of sources) removeEntity(state, id);
    for (const move of moves) {
      if (conflicts.has(move.entity.id)) continue;
      const entity = removeEntity(state, move.entity.id);
      if (entity) state.columns[move.destinationX].push(entity);
    }

    const nextArmed = new Set();
    for (const target of targets.values()) {
      if (target.armed && !sourceIds.has(target.entity.id)) nextArmed.add(target.entity.id);
    }
    stabilize(state);
    armed = nextArmed;
  }

  return explosions;
}

function drop(state, x) {
  const height = FLOOR[x] + state.columns[x].length;
  if (height >= 6) return null;
  const barrel = { id: state.nextId, type: TYPE.barrel, height };
  state.nextId += 1;
  state.columns[x].push(barrel);
  return explodeWaves(state, [barrel.id]);
}

function createState(stackStrings) {
  let nextId = 1;
  const columns = Array.from({ length: 10 }, () => []);
  for (let x = 2; x <= 7; x += 1) {
    columns[x] = [...stackStrings[x - 2]].map((type, index) => ({
      id: nextId++,
      type,
      height: FLOOR[x] + index,
    }));
  }
  return { nextId, columns };
}

function isSolved(state) {
  return BRIDGE_COLUMNS.every((x) => {
    const expected = x === 7 ? [TYPE.box, TYPE.box] : [TYPE.box];
    return state.columns[x].map(({ type }) => type).join("") === expected.join("");
  }) && state.columns.every((column, x) => (
    BRIDGE_COLUMNS.includes(x) || column.length === 0
  ));
}

function canCrossBridge(state) {
  const trial = cloneState(state);
  const playerHeight = 1;

  for (let x = 2; x <= 8; x += 1) {
    const target = entityAt(trial, x, playerHeight);
    if (target) {
      const top = trial.columns[x].at(-1);
      const destinationX = x + 1;
      if (top.id !== target.id
          || destinationX >= trial.columns.length
          || FLOOR[destinationX] > playerHeight
          || entityAt(trial, destinationX, playerHeight)) {
        return false;
      }

      removeEntity(trial, target.id);
      trial.columns[destinationX].push(target);
      stabilize(trial);
      const moved = trial.columns[destinationX].find(({ id }) => id === target.id);
      if (target.type === TYPE.barrel && moved.height < playerHeight) {
        explodeWaves(trial, [target.id]);
      }
      continue;
    }

    const supportHeight = FLOOR[x] + trial.columns[x].length;
    if (supportHeight !== playerHeight) return false;
  }

  return true;
}

function solveCandidate(stacks, solutionLimit = 12) {
  const solutions = [];
  let premature = false;

  const visit = (state, remaining, order, explosions) => {
    if (order.length < MINIMUM_DROPS && canCrossBridge(state)) {
      premature = true;
      return;
    }
    if (remaining.length === 0) {
      if (isSolved(state)) solutions.push({ order, explosions, state });
      return;
    }

    for (let index = 0; index < remaining.length; index += 1) {
      if (premature || solutions.length >= solutionLimit) return;
      const x = remaining[index];
      const next = cloneState(state);
      const count = drop(next, x);
      if (count === null) continue;
      visit(
        next,
        remaining.slice(0, index).concat(remaining.slice(index + 1)),
        [...order, x],
        explosions + count,
      );
    }
  };

  visit(createState(stacks), DROP_COLUMNS, [], 0);
  return premature ? [] : solutions;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStacks(random) {
  const lengths = BRIDGE_COLUMNS.map(() => 2 + Math.floor(random() * 3));
  const slots = lengths.flatMap((length, column) => (
    Array.from({ length }, (_, index) => ({ column, index }))
  ));
  const boxes = new Set();
  while (boxes.size < 7) boxes.add(Math.floor(random() * slots.length));
  const stacks = lengths.map((length) => Array(length).fill(TYPE.barrel));
  for (const slotIndex of boxes) {
    const { column, index } = slots[slotIndex];
    stacks[column][index] = TYPE.box;
  }
  return stacks.map((stack) => stack.join(""));
}

function levelWithStacks(baseLevel, stacks) {
  const retained = baseLevel.entities.filter(({ coordinate }) => coordinate.y !== 6);
  let nextId = Math.max(...retained.map(({ id }) => Number(id))) + 1;
  const added = [];
  for (let x = 2; x <= 7; x += 1) {
    for (let index = 0; index < stacks[x - 2].length; index += 1) {
      added.push({
        id: String(nextId++),
        type: stacks[x - 2][index] === TYPE.box ? "box" : "barrel",
        coordinate: { x, y: 6 },
        bottomHalfSteps: index * 2,
      });
    }
  }
  return { ...baseLevel, entities: [...retained, ...added] };
}

function movesForDrops(order) {
  const moves = Array(8).fill("north");
  let x = 0;
  for (const targetX of order) {
    const direction = targetX > x ? "east" : "west";
    moves.push(...Array(Math.abs(targetX - x)).fill(direction), "south", "north");
    x = targetX;
  }
  return moves;
}

function exitRouteFrom(x) {
  return [
    ...Array(x).fill("west"),
    ...Array(8).fill("south"),
    "east",
    ...Array(6).fill("north"),
    ...Array(7).fill("east"),
    ...Array(6).fill("south"),
  ];
}

function findWinWithEngine(module, level, maximumDrops) {
  const engine = module.gameRules.createEngine();
  try {
    const loaded = engine.loadLevel(level);
    if (loaded.status !== "loaded") return { invalidLevel: loaded };
    for (const direction of Array(8).fill("north")) {
      if (!engine.move(direction).accepted) return { invalidAscent: true };
    }

    const run = (moves) => {
      let accepted = 0;
      let won = false;
      for (const direction of moves) {
        const result = engine.move(direction);
        if (!result.accepted) break;
        accepted += 1;
        if (result.outcome === "won") {
          won = true;
          break;
        }
      }
      return { accepted, won };
    };
    const restore = (count) => {
      for (let index = 0; index < count; index += 1) engine.rewind();
    };

    const search = (prefix, remaining, x) => {
      const crossing = run(exitRouteFrom(x));
      restore(crossing.accepted);
      if (crossing.won) return prefix;
      if (prefix.length === maximumDrops) return null;

      for (let index = 0; index < remaining.length; index += 1) {
        const targetX = remaining[index];
        const direction = targetX > x ? "east" : "west";
        const dropMoves = [
          ...Array(Math.abs(targetX - x)).fill(direction),
          "south",
          "north",
        ];
        const dropped = run(dropMoves);
        if (dropped.accepted === dropMoves.length && !dropped.won) {
          const nextRemaining = remaining.slice(0, index).concat(remaining.slice(index + 1));
          const found = search([...prefix, targetX], nextRemaining, targetX);
          restore(dropped.accepted);
          if (found) return found;
        } else {
          restore(dropped.accepted);
        }
      }
      return null;
    };

    return search([], DROP_COLUMNS, 0);
  } finally {
    engine.destroy();
  }
}

async function verifyWithEngine(level, order) {
  const { default: createGameRulesModule } = await import(wasmPath);
  const module = await createGameRulesModule();
  const engine = module.gameRules.createEngine();
  try {
    const loaded = engine.loadLevel(level);
    if (loaded.status !== "loaded") return { accepted: false, reason: loaded };
    const results = [];
    for (const direction of movesForDrops(order)) {
      const result = engine.move(direction);
      results.push(result);
      if (!result.accepted) return { accepted: false, reason: result };
    }
    const bridgeState = results.at(-1).state;
    const rowEntities = bridgeState.entities.filter(({ coordinate }) => coordinate.y === 6);
    const expectedBridge = [
      [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [7, 2],
    ];
    const actualBridge = rowEntities
      .filter(({ type }) => type === "box")
      .map(({ coordinate, bottomHalfSteps }) => [coordinate.x, bottomHalfSteps]);
    const exactBridge = JSON.stringify(actualBridge) === JSON.stringify(expectedBridge)
      && rowEntities.every(({ type }) => type === "box");
    if (!exactBridge) return { accepted: false, reason: { actualBridge, rowEntities } };

    const exitRoute = exitRouteFrom(order.at(-1));
    for (const direction of exitRoute) {
      const result = engine.move(direction);
      if (!result.accepted) return { accepted: false, reason: result };
      results.push(result);
    }
    const final = results.at(-1);
    if (final.outcome !== "won") return { accepted: false, reason: final };

    const tooShortOrder = findWinWithEngine(module, level, MINIMUM_DROPS - 1);
    if (tooShortOrder) {
      return { accepted: false, reason: { tooShortOrder } };
    }
    const crossingOrder = findWinWithEngine(module, level, MINIMUM_DROPS);
    return { accepted: true, bridge: rowEntities, state: final.state, crossingOrder };
  } finally {
    engine.destroy();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const baseLevel = JSON.parse(await readFile(levelPath, "utf8"));
  const random = seededRandom(0xc04ec7f0);
  const attempts = Number(process.env.CONNECT_FORE_ATTEMPTS ?? 10000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const stacks = randomStacks(random);
    const solutions = solveCandidate(stacks);
    if (solutions.length === 0 || solutions.length > 8) continue;

    for (const solution of solutions) {
      const level = levelWithStacks(baseLevel, stacks);
      const verified = await verifyWithEngine(level, solution.order);
      if (!verified.accepted) continue;

      const summary = {
        attempt,
        stacks,
        crossingOrder: verified.crossingOrder,
        exactBridgeOrder: solution.order,
        exactBridgeExplosions: solution.explosions,
        minimumRequiredDrops: MINIMUM_DROPS,
      };
      console.log(JSON.stringify(summary, null, 2));
      if (args.has("--write")) {
        await writeFile(levelPath, `${JSON.stringify(level, null, 2)}\n`);
        console.log(`Wrote ${levelPath}`);
      }
      return;
    }
  }

  throw new Error(`No verified candidate found in ${attempts} attempts.`);
}

await main();
