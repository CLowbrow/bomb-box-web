import { fromLevelDefinition, isLevelDefinitionV1, toLevelDefinition } from "./domain";
import type { DraftDocument, DraftEnvelopeV1, PlaytestEnvelopeV1 } from "./types";

export const DRAFT_STORAGE_KEY = "game-rules-editor:draft:v1";
export const PLAYTEST_STORAGE_KEY = "game-rules:playtest:v1";

export function makeDraftEnvelope(document: DraftDocument, displayName: string): DraftEnvelopeV1 {
  return {
    envelopeVersion: 1,
    displayName,
    savedAt: new Date().toISOString(),
    level: toLevelDefinition(document),
  };
}

export function makePlaytestEnvelope(
  document: DraftDocument,
  displayName: string,
): PlaytestEnvelopeV1 {
  return {
    envelopeVersion: 1,
    displayName,
    savedAt: new Date().toISOString(),
    level: toLevelDefinition(document),
  };
}

export function saveDraft(storage: Storage, document: DraftDocument, displayName: string): void {
  storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(makeDraftEnvelope(document, displayName)));
}

export function loadDraft(storage: Storage): { document: DraftDocument; displayName: string } | null {
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Partial<DraftEnvelopeV1>;
    if (envelope.envelopeVersion !== 1
        || typeof envelope.displayName !== "string"
        || !isLevelDefinitionV1(envelope.level)) return null;
    return {
      document: fromLevelDefinition(envelope.level),
      displayName: envelope.displayName,
    };
  } catch {
    return null;
  }
}

export function discardDraft(storage: Storage): void {
  storage.removeItem(DRAFT_STORAGE_KEY);
}

export function savePlaytest(storage: Storage, document: DraftDocument, displayName: string): void {
  storage.setItem(PLAYTEST_STORAGE_KEY, JSON.stringify(makePlaytestEnvelope(document, displayName)));
}
