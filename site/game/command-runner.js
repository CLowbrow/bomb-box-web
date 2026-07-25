export async function performCommand(command, { setBusy, present, onError }) {
  setBusy(true);
  try {
    await present(command());
  } catch (error) {
    onError(error);
  } finally {
    setBusy(false);
  }
}

export function createLatestMoveRunner(execute, {
  canMove = () => true,
} = {}) {
  let running = false;
  let bufferedDirection = null;

  return {
    isRunning() {
      return running;
    },

    async request(direction) {
      if (!canMove()) {
        return;
      }
      if (running) {
        bufferedDirection = direction;
        return;
      }

      running = true;
      try {
        let nextDirection = direction;
        while (nextDirection !== null) {
          await execute(nextDirection);
          if (!canMove()) {
            bufferedDirection = null;
            break;
          }
          nextDirection = bufferedDirection;
          bufferedDirection = null;
        }
      } finally {
        running = false;
      }
    },
  };
}
