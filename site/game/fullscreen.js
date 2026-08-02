export function createFullscreenController(element, button, {
  documentObject = document,
} = {}) {
  let fallbackActive = false;

  function isNativeFullscreen() {
    return documentObject.fullscreenElement === element;
  }

  function sync() {
    const active = isNativeFullscreen() || fallbackActive;
    element.classList.toggle("is-fullscreen", active);
    element.classList.toggle("is-fullscreen-fallback", fallbackActive);
    documentObject.body.classList.toggle("fullscreen-fallback-active", fallbackActive);
    button.textContent = active ? "Exit full screen" : "Full screen";
    button.setAttribute("aria-pressed", String(active));
  }

  async function enter() {
    if (typeof element.requestFullscreen === "function") {
      try {
        await element.requestFullscreen();
        sync();
        return;
      } catch (error) {
        console.warn("[Bomb Box] Browser fullscreen was unavailable; using windowed fullscreen.", error);
      }
    }
    fallbackActive = true;
    sync();
  }

  async function exit() {
    if (isNativeFullscreen() && typeof documentObject.exitFullscreen === "function") {
      try {
        await documentObject.exitFullscreen();
      } catch (error) {
        console.warn("[Bomb Box] Could not exit browser fullscreen.", error);
      }
    }
    fallbackActive = false;
    sync();
  }

  function toggle() {
    return isNativeFullscreen() || fallbackActive ? exit() : enter();
  }

  function handleFullscreenChange() {
    sync();
  }

  function handleKeydown(event) {
    if (event.key !== "Escape" || !fallbackActive) return;
    event.preventDefault();
    void exit();
    button.focus({ preventScroll: true });
  }

  documentObject.addEventListener("fullscreenchange", handleFullscreenChange);
  documentObject.addEventListener("keydown", handleKeydown);
  sync();

  return {
    toggle,
    dispose() {
      fallbackActive = false;
      sync();
      documentObject.removeEventListener("fullscreenchange", handleFullscreenChange);
      documentObject.removeEventListener("keydown", handleKeydown);
    },
  };
}
