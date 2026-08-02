import { afterEach, describe, expect, it, vi } from "vitest";
import { createFullscreenController } from "../site/game/fullscreen.js";

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = "";
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document, "exitFullscreen");
  vi.restoreAllMocks();
});

function surface() {
  const element = document.createElement("section");
  const button = document.createElement("button");
  document.body.append(element, button);
  return { element, button };
}

describe("game fullscreen controller", () => {
  it("uses full-window mode when the browser fullscreen API is unavailable", async () => {
    const { element, button } = surface();
    const controller = createFullscreenController(element, button);

    await controller.toggle();

    expect(element.classList).toContain("is-fullscreen");
    expect(element.classList).toContain("is-fullscreen-fallback");
    expect(document.body.classList).toContain("fullscreen-fallback-active");
    expect(button.textContent).toBe("Exit full screen");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(element.classList).not.toContain("is-fullscreen");
    expect(document.body.classList).not.toContain("fullscreen-fallback-active");
    expect(button.textContent).toBe("Full screen");
    expect(document.activeElement).toBe(button);
  });

  it("uses the native fullscreen API and follows browser fullscreen changes", async () => {
    const { element, button } = surface();
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(element, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = element;
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
    const controller = createFullscreenController(element, button);

    await controller.toggle();
    expect(element.requestFullscreen).toHaveBeenCalledOnce();
    expect(element.classList).toContain("is-fullscreen");
    expect(element.classList).not.toContain("is-fullscreen-fallback");

    await controller.toggle();
    expect(document.exitFullscreen).toHaveBeenCalledOnce();
    expect(element.classList).not.toContain("is-fullscreen");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    controller.dispose();
  });
});
