import { dynamicStateFromFull } from "./scene-model.js";

export const TICK_DURATION_MS = 500;

export async function playEngineResult(result, view, {
  durationMs = TICK_DURATION_MS,
  onTickStart = () => {},
  onState = () => {},
} = {}) {
  if (!result.state) return;

  if (result.operation === "loadLevel") {
    view.setWorld(result.state);
    view.show(result.initialState ?? dynamicStateFromFull(result.state));
  } else if (result.initialState) {
    view.show(result.initialState);
  }

  const ticks = result.ticks ?? [];
  if (ticks.length) {
    for (let index = 0; index < ticks.length; index += 1) {
      const tick = ticks[index];
      onTickStart(tick, index, ticks.length);
      await view.animateTo(tick.stateAfter, tick.events, durationMs);
      onState(tick.stateAfter);
    }
  } else if (result.operation === "rewind" && result.accepted) {
    const restored = dynamicStateFromFull(result.state);
    onTickStart({ index: 0, events: result.events ?? [], stateAfter: restored }, 0, 1);
    await view.animateTo(restored, result.events ?? [], durationMs);
    onState(restored);
  }

  const finalState = dynamicStateFromFull(result.state);
  view.show(finalState);
  onState(finalState);
}
