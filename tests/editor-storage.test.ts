import { describe, expect, it } from "vitest";
import { createLevel } from "../site/editor/domain";
import {
  DRAFT_STORAGE_KEY,
  PLAYTEST_STORAGE_KEY,
  discardDraft,
  loadDraft,
  saveDraft,
  savePlaytest,
} from "../site/editor/storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("editor storage contracts", () => {
  it("round-trips a versioned invalid-or-valid draft without history", () => {
    const storage = new MemoryStorage();
    const document = createLevel({ width: 2, height: 1 });
    document.entities = {};
    saveDraft(storage, document, "Recovery test");
    const restored = loadDraft(storage);
    expect(restored?.displayName).toBe("Recovery test");
    expect(restored?.document.entities).toEqual({});
    expect(JSON.parse(storage.getItem(DRAFT_STORAGE_KEY)!)).not.toHaveProperty("past");
  });

  it("rejects incompatible envelopes and supports explicit discard", () => {
    const storage = new MemoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ envelopeVersion: 2 }));
    expect(loadDraft(storage)).toBeNull();
    discardDraft(storage);
    expect(storage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("keeps playtest transport separate from draft recovery", () => {
    const storage = new MemoryStorage();
    savePlaytest(storage, createLevel(), "Playable draft");
    const envelope = JSON.parse(storage.getItem(PLAYTEST_STORAGE_KEY)!);
    expect(envelope).toMatchObject({ envelopeVersion: 1, displayName: "Playable draft" });
    expect(storage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("surfaces quota failures to callers", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    expect(() => saveDraft(storage, createLevel(), "No room")).toThrow("full");
  });
});
