import { afterEach, describe, expect, it, vi } from "vitest";
import { createLevel, toLevelDefinition } from "../site/editor/domain";
import { PLAYTEST_STORAGE_KEY } from "../site/editor/storage";
import { cannedLevels, resolveLevelSource } from "../site/level-source.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

afterEach(() => vi.restoreAllMocks());

describe("game level source", () => {
  it("uses the first canned level by default", async () => {
    const storage = new MemoryStorage();
    const source = await resolveLevelSource({
      location: new URL("https://example.test/game/") as unknown as Location,
      storage,
    });
    expect(source.fromEditor).toBe(false);
    expect(source).toMatchObject(cannedLevels[0]);
  });

  it("selects a canned level from the URL", async () => {
    const storage = new MemoryStorage();
    const requested = cannedLevels.at(-1)!;
    const source = await resolveLevelSource({
      location: new URL(`https://example.test/game/?level=${requested.id}`) as unknown as Location,
      storage,
    });
    expect(source).toMatchObject(requested);
    expect(source.fromEditor).toBe(false);
  });

  it("loads a compatible editor handoff without fetching the sample", async () => {
    const storage = new MemoryStorage();
    const level = toLevelDefinition(createLevel());
    storage.setItem(PLAYTEST_STORAGE_KEY, JSON.stringify({
      envelopeVersion: 1,
      displayName: "My level",
      savedAt: new Date().toISOString(),
      level,
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const source = await resolveLevelSource({
      location: new URL("https://example.test/game/?levelSource=editor") as unknown as Location,
      storage,
    });
    expect(source).toMatchObject({ fromEditor: true, displayName: "My level", level });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing editor payload instead of falling back", async () => {
    const storage = new MemoryStorage();
    await expect(resolveLevelSource({
      location: new URL("https://example.test/game/?levelSource=editor") as unknown as Location,
      storage,
    })).rejects.toThrow("No compatible editor playtest");
  });
});
