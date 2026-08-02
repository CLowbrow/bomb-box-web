export const NEXT_LEVEL_DELAY_MS = 3000;

export function createLevelAdvanceController({
  levels,
  getCurrentLevelId,
  advance,
  delayMs = NEXT_LEVEL_DELAY_MS,
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer),
}) {
  let timer = null;

  function cancel() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function update(outcome) {
    if (outcome !== "won") {
      cancel();
      return;
    }
    if (timer !== null) return;

    const currentIndex = levels.findIndex(({ id }) => id === getCurrentLevelId());
    const nextLevel = currentIndex >= 0 ? levels[currentIndex + 1] : null;
    if (!nextLevel) return;

    timer = setTimer(() => {
      timer = null;
      advance(nextLevel);
    }, delayMs);
  }

  return { update, cancel };
}
