export const PLAYTEST_STORAGE_KEY = "game-rules:playtest:v1";

const cannedLevelModules = import.meta.glob("./levels/canned/*.json", {
  eager: true,
  import: "default",
});

function isLevel(value) {
  return value
    && typeof value === "object"
    && value.format === "game-rules-level"
    && value.version === 1
    && Array.isArray(value.cells)
    && Array.isArray(value.fixtures)
    && Array.isArray(value.entities);
}

function displayNameFor(id) {
  return id
    .replace(/^\d+[-_]?/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const cannedLevels = Object.freeze(
  Object.entries(cannedLevelModules)
    .map(([path, level]) => {
      const id = path.split("/").at(-1).replace(/\.json$/, "");
      if (!isLevel(level)) throw new Error(`Canned level ${id} is not a version 1 game-rules level.`);
      return Object.freeze({ id, displayName: displayNameFor(id), level });
    })
    .sort((left, right) => left.id.localeCompare(right.id)),
);

export const defaultCannedLevel = cannedLevels[0] ?? null;

export function findCannedLevel(id) {
  return cannedLevels.find((entry) => entry.id === id) ?? null;
}

export async function resolveLevelSource({ location = window.location, storage = localStorage } = {}) {
  const search = new URLSearchParams(location.search);
  if (search.get("levelSource") !== "editor") {
    const requested = findCannedLevel(search.get("level"));
    const selected = requested ?? defaultCannedLevel;
    if (!selected) throw new Error("No canned levels were found.");
    return { ...selected, fromEditor: false };
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
    id: null,
    level: envelope.level,
    displayName: envelope.displayName || "Editor playtest",
    fromEditor: true,
  };
}
