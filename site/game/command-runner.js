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
