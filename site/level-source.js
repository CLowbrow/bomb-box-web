export const PLAYTEST_STORAGE_KEY = "game-rules:playtest:v1";

function isLevel(value) {
  return value
    && typeof value === "object"
    && value.format === "game-rules-level"
    && value.version === 1
    && Array.isArray(value.cells)
    && Array.isArray(value.fixtures)
    && Array.isArray(value.entities);
}

export async function resolveLevelSource({ location = window.location, storage = localStorage } = {}) {
  const source = new URLSearchParams(location.search).get("levelSource");
  if (source !== "editor") {
    const response = await fetch("./levels/hardening-run.json");
    if (!response.ok) throw new Error(`level request failed with ${response.status}`);
    return {
      level: await response.json(),
      displayName: "Rewind stress scenario",
      fromEditor: false,
    };
  }

  let envelope;
  try {
    const raw = storage.getItem(PLAYTEST_STORAGE_KEY);
    envelope = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("The editor playtest payload could not be read.");
  }
  if (!envelope
      || envelope.envelopeVersion !== 1
      || typeof envelope.displayName !== "string"
      || !isLevel(envelope.level)) {
    throw new Error("No compatible editor playtest is available. Return to the editor and choose Playtest again.");
  }
  return {
    level: envelope.level,
    displayName: envelope.displayName || "Editor playtest",
    fromEditor: true,
  };
}
