import { render } from "preact";
import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import {
  MAX_BOARD_SIZE,
  coordinateKey,
  createLevel,
  directionArrow,
  entitiesAt,
  fromLevelDefinition,
  isLevelDefinitionV1,
  resizeDocument,
  screenCoordinates,
  screenNeighbor,
  serializeLevel,
  toInteger,
  toLevelDefinition,
} from "./domain";
import { editorReducer, initialEditorState } from "./reducer";
import {
  discardDraft,
  loadDraft,
  saveDraft,
  savePlaytest,
} from "./storage";
import type {
  AxisX,
  AxisY,
  CellGeometry,
  Coordinate,
  Direction,
  EngineJsonError,
  EngineLoadResult,
  EngineValidationError,
  Entity,
  EntityType,
  FixtureColor,
  FixtureKind,
  LevelDefinitionV1,
  ResizeAnchor,
  ToolKind,
  ValidationState,
} from "./types";

interface RulesEngine {
  loadLevel(level: LevelDefinitionV1 | string): EngineLoadResult;
  destroy(): void;
}

const TOOL_OPTIONS: Array<{ kind: ToolKind; label: string; glyph: string }> = [
  { kind: "select", label: "Select", glyph: "↖" },
  { kind: "flat", label: "Flat", glyph: "▦" },
  { kind: "ramp", label: "Ramp", glyph: "◩" },
  { kind: "player", label: "Player", glyph: "P" },
  { kind: "box", label: "Box", glyph: "■" },
  { kind: "barrel", label: "Barrel", glyph: "●" },
  { kind: "exit", label: "Exit", glyph: "◇" },
  { kind: "switch", label: "Switch", glyph: "SW" },
  { kind: "door", label: "Door", glyph: "D" },
  { kind: "eraser", label: "Erase", glyph: "×" },
];

const COLOR_OPTIONS: FixtureColor[] = ["red", "green", "blue", "yellow"];
const DIRECTION_OPTIONS: Direction[] = ["north", "east", "south", "west"];
const ENTITY_GLYPHS: Record<EntityType, string> = { player: "P", box: "■", barrel: "●" };

type Overlay = "new" | "resize" | "coordinates" | "import" | null;

function App() {
  const recovered = useMemo(() => safeLoadDraft(), []);
  const [state, dispatch] = useReducer(
    editorReducer,
    initialEditorState(recovered?.document, recovered?.displayName),
  );
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [validation, setValidation] = useState<ValidationState>({
    status: "loading",
    issues: [],
    message: "Loading authoritative validator…",
  });
  const [storageMessage, setStorageMessage] = useState("");
  const [restored, setRestored] = useState(Boolean(recovered));
  const [engine, setEngine] = useState<RulesEngine | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  useEffect(() => {
    let active = true;
    let ownedEngine: RulesEngine | null = null;
    const moduleUrl = new URL("../wasm/game_rules.mjs", document.baseURI).href;
    import(/* @vite-ignore */ moduleUrl)
      .then(({ default: createGameRulesModule }) => createGameRulesModule({
        locateFile: (file: string) => new URL(`../wasm/${file}`, document.baseURI).href,
      }))
      .then((module) => {
        if (!active) return;
        ownedEngine = module.gameRules.createEngine();
        setEngine(ownedEngine);
      })
      .catch((error) => setValidation({
        status: "error",
        issues: [],
        message: `Validator failed to load: ${error.message}`,
      }));
    return () => {
      active = false;
      ownedEngine?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    setValidation((current) => ({ ...current, status: "pending", message: "Checking level…" }));
    const timer = window.setTimeout(() => {
      try {
        setValidation(validationFromResult(engine.loadLevel(toLevelDefinition(state.document))));
      } catch (error) {
        setValidation({
          status: "error",
          issues: [],
          message: `Validation failed: ${(error as Error).message}`,
        });
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [engine, state.document]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        saveDraft(localStorage, state.document, state.displayName);
        setStorageMessage(`Autosaved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      } catch (error) {
        setStorageMessage(`Autosave unavailable: ${(error as Error).message}`);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state.document, state.displayName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if (modifier && event.key.toLowerCase() === "c") {
        event.preventDefault();
        dispatch({ type: "copySelectedCell" });
      } else if (modifier && event.key.toLowerCase() === "v") {
        event.preventDefault();
        dispatch({ type: "pasteSelectedCell" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedKey = coordinateKey(state.selected);
  const selectedGeometry = state.document.cells[selectedKey];
  const selectedFixture = state.document.fixtures[selectedKey];
  const selectedEntities = entitiesAt(state.document, state.selected);
  const selectedEntity = state.selectedEntityId
    ? state.document.entities[state.selectedEntityId]
    : null;
  const issueKeys = useMemo(() => new Set(validation.issues
    .map(issueCoordinate)
    .filter((coordinate): coordinate is Coordinate => Boolean(coordinate))
    .map(coordinateKey)), [validation.issues]);

  const handleImport = () => {
    if (!engine) {
      setImportError("The validator is still loading.");
      return;
    }
    let result: EngineLoadResult;
    try {
      result = engine.loadLevel(importText);
    } catch (error) {
      setImportError((error as Error).message);
      return;
    }
    if (result.status === "invalid_json") {
      setImportError(formatJsonError(result.error));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (error) {
      setImportError((error as Error).message);
      return;
    }
    if (!isLevelDefinitionV1(parsed)) {
      setImportError(`The editor supports version 1 boards from 1×1 through ${MAX_BOARD_SIZE}×${MAX_BOARD_SIZE}.`);
      return;
    }
    dispatch({
      type: "replaceDocument",
      document: fromLevelDefinition(parsed),
      displayName: "Imported level",
      notice: result.status === "loaded"
        ? "Imported an engine-valid level."
        : "Imported a structurally invalid level for repair.",
    });
    setImportText("");
    setImportError("");
    setOverlay(null);
  };

  const handleDownload = () => {
    const json = serializeLevel(state.document);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFilename(state.displayName)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    dispatch({ type: "setNotice", notice: "Downloaded engine-format JSON." });
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(serializeLevel(state.document));
      dispatch({ type: "setNotice", notice: "Copied engine-format JSON." });
    } catch {
      dispatch({ type: "setNotice", notice: "Clipboard access was unavailable; use Download instead." });
    }
  };

  const handlePlaytest = (event: MouseEvent) => {
    try {
      savePlaytest(localStorage, state.document, state.displayName);
      dispatch({ type: "setNotice", notice: "Opened the validated level in the game." });
    } catch (error) {
      event.preventDefault();
      dispatch({ type: "setNotice", notice: `Playtest unavailable: ${(error as Error).message}` });
    }
  };

  const clearRecoveredDraft = () => {
    try { discardDraft(localStorage); } catch { /* the new draft still works in memory */ }
    dispatch({ type: "newDocument", document: createLevel(), displayName: "Untitled level" });
    setRestored(false);
  };

  return (
    <main class="editor-shell">
      <header class="editor-header">
        <div>
          <p class="eyebrow">Game-rules authoring</p>
          <div class="title-row">
            <h1>Level Editor</h1>
            <a href="../" class="game-link">Back to game ↗</a>
          </div>
          <input
            class="level-name"
            aria-label="Level display name"
            value={state.displayName}
            onInput={(event) => dispatch({
              type: "setDisplayName",
              displayName: event.currentTarget.value,
            })}
          />
        </div>
        <div class={`validation-pill is-${validation.status}`} role="status">
          <span aria-hidden="true" />
          {validation.status === "valid" ? "Engine valid" : validation.message}
        </div>
      </header>

      {restored && (
        <div class="recovery-banner">
          <span>Recovered the last device-local draft.</span>
          <button type="button" onClick={() => setRestored(false)}>Keep editing</button>
          <button type="button" onClick={clearRecoveredDraft}>Discard and start new</button>
        </div>
      )}

      <nav class="command-bar" aria-label="Document controls">
        <button type="button" onClick={() => setOverlay("new")}>New</button>
        <button type="button" onClick={() => setOverlay("import")}>Import</button>
        <button type="button" disabled={validation.status !== "valid"} onClick={handleDownload}>Download</button>
        <button type="button" disabled={validation.status !== "valid"} onClick={handleCopyJson}>Copy JSON</button>
        <span class="command-separator" />
        <button type="button" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>Undo</button>
        <button type="button" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>Redo</button>
        <button type="button" onClick={() => dispatch({ type: "copySelectedCell" })}>Copy cell</button>
        <button type="button" disabled={!state.clipboard} onClick={() => dispatch({ type: "pasteSelectedCell" })}>Paste cell</button>
        <button type="button" class="danger-control" onClick={() => dispatch({ type: "deleteSelected" })}>Delete</button>
        <span class="command-separator" />
        <button type="button" onClick={() => setOverlay("resize")}>Resize</button>
        <button type="button" onClick={() => setOverlay("coordinates")}>Coordinates</button>
        {validation.status === "valid"
          ? (
            <a
              class="playtest-control"
              href="../?levelSource=editor"
              onClick={handlePlaytest}
            >
              Playtest ↗
            </a>
          )
          : <button type="button" class="playtest-control" disabled>Playtest ↗</button>}
      </nav>

      <section class="editor-workspace">
        <aside class="tool-panel" aria-label="Placement tools">
          <div class="panel-title">
            <p class="eyebrow">Palette</p>
            <h2>Place one cell</h2>
          </div>
          <div class="tool-grid">
            {TOOL_OPTIONS.map((option) => (
              <button
                key={option.kind}
                type="button"
                class={`tool-button ${state.tool.kind === option.kind ? "is-active" : ""}`}
                aria-pressed={state.tool.kind === option.kind}
                onClick={() => dispatch({ type: "setTool", tool: option.kind })}
              >
                <span aria-hidden="true">{option.glyph}</span>{option.label}
              </button>
            ))}
          </div>
          <ToolOptions state={state} dispatch={dispatch} />
          <div class="shortcut-card">
            <p><kbd>↑↓←→</kbd> move selection</p>
            <p><kbd>Enter</kbd> apply tool</p>
            <p><kbd>⌘/Ctrl Z</kbd> undo</p>
            <p><kbd>⌘/Ctrl C/V</kbd> cell copy/paste</p>
          </div>
        </aside>

        <section class="board-panel" aria-label="Level grid workspace">
          <div class="board-toolbar">
            <div>
              <p class="eyebrow">Board</p>
              <strong>{state.document.width} × {state.document.height}</strong>
              <span> origin {coordinateKey(state.document.coordinateSystem.origin)}</span>
            </div>
            <div class="zoom-controls" aria-label="Grid zoom">
              <button type="button" onClick={() => dispatch({ type: "setZoom", zoom: state.zoom - 0.15 })}>−</button>
              <output>{Math.round(state.zoom * 100)}%</output>
              <button type="button" onClick={() => dispatch({ type: "setZoom", zoom: state.zoom + 0.15 })}>+</button>
            </div>
          </div>
          <div class="board-scroll">
            <div
              class="editor-board"
              role="grid"
              aria-label="Editable level grid"
              style={{
                "--columns": state.document.width,
                "--cell-size": `${Math.round(70 * state.zoom)}px`,
              }}
            >
              {screenCoordinates(state.document).map((coordinate) => {
                const key = coordinateKey(coordinate);
                const geometry = state.document.cells[key];
                const fixture = state.document.fixtures[key];
                const entities = entitiesAt(state.document, coordinate);
                const selected = key === selectedKey;
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    data-coordinate={key}
                    tabIndex={selected ? 0 : -1}
                    class={`editor-cell cell-${geometry.type} ${selected ? "is-selected" : ""} ${issueKeys.has(key) ? "has-issue" : ""}`}
                    aria-label={cellDescription(coordinate, geometry, fixture, entities)}
                    onClick={() => dispatch({
                      type: state.tool.kind === "select" ? "select" : "applyTool",
                      coordinate,
                    })}
                    onKeyDown={(event) => handleCellKeyDown(event, coordinate, state, dispatch)}
                  >
                    <span class="cell-coordinate">{key}</span>
                    <span class="cell-height">{geometry.type === "flat" ? `z${geometry.elevation}` : `z${geometry.lowElevation + 0.5}`}</span>
                    {geometry.type === "ramp" && <span class="cell-ramp-arrow">{directionArrow(geometry.lowDirection)}</span>}
                    {fixture && <span class={`cell-fixture fixture-${fixture.type} fixture-${"color" in fixture ? fixture.color : "exit"}`}>{fixtureLabel(fixture)}</span>}
                    <span class="cell-stack">
                      {entities.slice(-4).map((entity) => (
                        <i key={entity.id} class={`mini-entity entity-${entity.type}`} title={`${entity.type} ${entity.id} at ${entity.bottomHalfSteps}/2`}>
                          {ENTITY_GLYPHS[entity.type]}
                        </i>
                      ))}
                    </span>
                    {entities.length > 4 && <span class="stack-overflow">+{entities.length - 4}</span>}
                    {issueKeys.has(key) && <span class="issue-marker" aria-label="Validation issue">!</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <footer class="board-status" aria-live="polite">
            <span>{state.notice || "Choose a tool, then select a cell."}</span>
            <span>{storageMessage}</span>
          </footer>
        </section>

        <aside class="inspector-panel" aria-label="Selected cell inspector">
          <div class="panel-title inspector-title">
            <div><p class="eyebrow">Inspector</p><h2>Cell {selectedKey}</h2></div>
            <span>{selectedEntities.length} object{selectedEntities.length === 1 ? "" : "s"}</span>
          </div>
          <CellInspector
            coordinate={state.selected}
            geometry={selectedGeometry}
            fixture={selectedFixture}
            entities={selectedEntities}
            selectedEntity={selectedEntity}
            allEntities={state.document.entities}
            dispatch={dispatch}
          />
          <IssuePanel validation={validation} selectedKey={selectedKey} dispatch={dispatch} />
        </aside>
      </section>

      {overlay === "new" && <NewLevelDialog onClose={() => setOverlay(null)} onCreate={(document, name) => {
        dispatch({ type: "newDocument", document, displayName: name });
        setRestored(false);
        setOverlay(null);
      }} />}
      {overlay === "resize" && <ResizeDialog state={state} onClose={() => setOverlay(null)} dispatch={dispatch} />}
      {overlay === "coordinates" && <CoordinateDialog state={state} onClose={() => setOverlay(null)} dispatch={dispatch} />}
      {overlay === "import" && (
        <Modal title="Import engine JSON" onClose={() => setOverlay(null)}>
          <textarea
            class="import-field"
            value={importText}
            onInput={(event) => { setImportText(event.currentTarget.value); setImportError(""); }}
            placeholder='Paste a version 1 { "format": "game-rules-level", ... } document'
            aria-label="Level JSON"
            autofocus
          />
          <label class="file-picker">Or choose a JSON file<input type="file" accept="application/json,.json" onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            setImportText(await file.text());
            setImportError("");
          }} /></label>
          {importError && <p class="form-error" role="alert">{importError}</p>}
          <div class="dialog-actions">
            <button type="button" onClick={() => setOverlay(null)}>Cancel</button>
            <button type="button" class="primary-control" disabled={!importText.trim()} onClick={handleImport}>Import level</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function ToolOptions({ state, dispatch }: { state: ReturnType<typeof initialEditorState>; dispatch: (action: any) => void }) {
  if (state.tool.kind === "flat") {
    return <div class="tool-options"><label>Elevation<CommitNumberInput value={state.tool.elevation} onCommit={(elevation) => dispatch({ type: "setToolElevation", elevation })} /></label></div>;
  }
  if (state.tool.kind === "ramp") {
    return (
      <div class="tool-options">
        <label>Low elevation<CommitNumberInput value={state.tool.lowElevation} onCommit={(lowElevation) => dispatch({ type: "setToolLowElevation", lowElevation })} /></label>
        <label>Low direction<select value={state.tool.lowDirection} onChange={(event) => dispatch({ type: "setToolLowDirection", lowDirection: event.currentTarget.value })}>{DIRECTION_OPTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
      </div>
    );
  }
  if (state.tool.kind === "switch" || state.tool.kind === "door") {
    return <ColorPicker value={state.tool.color} onChange={(color) => dispatch({ type: "setToolColor", color })} />;
  }
  return <p class="tool-help">{toolHelp(state.tool.kind)}</p>;
}

function CellInspector({ coordinate, geometry, fixture, entities, selectedEntity, allEntities, dispatch }: {
  coordinate: Coordinate;
  geometry: CellGeometry;
  fixture?: FixtureKind;
  entities: Entity[];
  selectedEntity: Entity | null;
  allEntities: Record<string, Entity>;
  dispatch: (action: any) => void;
}) {
  const fixtureType = fixture?.type ?? "none";
  return (
    <div class="inspector-content">
      <section class="inspector-section">
        <h3>Terrain</h3>
        <label>Type<select value={geometry.type} onChange={(event) => {
          const type = event.currentTarget.value;
          dispatch({
            type: "setCellGeometry",
            coordinate,
            geometry: type === "flat"
              ? { type: "flat", elevation: geometry.type === "flat" ? geometry.elevation : geometry.lowElevation }
              : { type: "ramp", lowDirection: "west", lowElevation: geometry.type === "flat" ? geometry.elevation : geometry.lowElevation },
          });
        }}><option value="flat">Flat</option><option value="ramp">Ramp</option></select></label>
        {geometry.type === "flat" ? (
          <label>Elevation<CommitNumberInput value={geometry.elevation} onCommit={(elevation) => dispatch({ type: "setCellGeometry", coordinate, geometry: { type: "flat", elevation } })} /></label>
        ) : (
          <>
            <label>Low elevation<CommitNumberInput value={geometry.lowElevation} onCommit={(lowElevation) => dispatch({ type: "setCellGeometry", coordinate, geometry: { ...geometry, lowElevation } })} /></label>
            <label>Low direction<select value={geometry.lowDirection} onChange={(event) => dispatch({ type: "setCellGeometry", coordinate, geometry: { ...geometry, lowDirection: event.currentTarget.value } })}>{DIRECTION_OPTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
          </>
        )}
      </section>

      <section class="inspector-section">
        <h3>Fixture</h3>
        <label>Type<select value={fixtureType} onChange={(event) => {
          const type = event.currentTarget.value;
          const next = type === "none" ? undefined
            : type === "exit" ? { type: "exit" }
              : { type, color: fixture && "color" in fixture ? fixture.color : "red" };
          dispatch({ type: "setFixture", coordinate, fixture: next });
        }}><option value="none">None</option><option value="exit">Exit</option><option value="switch">Switch</option><option value="door">Door</option></select></label>
        {fixture && fixture.type !== "exit" && <ColorPicker value={fixture.color} onChange={(color) => dispatch({ type: "setFixture", coordinate, fixture: { ...fixture, color } })} />}
      </section>

      <section class="inspector-section">
        <div class="section-heading"><h3>Stack</h3><span>bottom → top</span></div>
        {entities.length === 0 ? <p class="empty-state">No entities on this cell.</p> : (
          <div class="stack-list">
            {entities.map((entity) => (
              <button key={entity.id} type="button" class={selectedEntity?.id === entity.id ? "is-selected" : ""} onClick={() => dispatch({ type: "select", coordinate, entityId: entity.id })}>
                <span class={`entity-token entity-${entity.type}`}>{ENTITY_GLYPHS[entity.type]}</span>
                <span><strong>{entity.type}</strong><small>ID {entity.id} · {formatHalfSteps(entity.bottomHalfSteps)}</small></span>
              </button>
            ))}
          </div>
        )}
        {selectedEntity && (
          <div class="entity-form">
            <label>Type<select value={selectedEntity.type} onChange={(event) => dispatch({ type: "updateEntity", originalId: selectedEntity.id, entity: { ...selectedEntity, type: event.currentTarget.value } })}>{(["player", "box", "barrel"] as EntityType[]).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label>ID<CommitTextInput value={selectedEntity.id} onCommit={(id) => {
              if (!validEntityId(id) || (allEntities[id] && id !== selectedEntity.id)) {
                dispatch({ type: "setNotice", notice: "Entity IDs must be unique positive decimal uint64 strings." });
                return;
              }
              dispatch({ type: "updateEntity", originalId: selectedEntity.id, entity: { ...selectedEntity, id } });
            }} /></label>
            <label>Bottom half-steps<CommitNumberInput value={selectedEntity.bottomHalfSteps} onCommit={(bottomHalfSteps) => dispatch({ type: "updateEntity", originalId: selectedEntity.id, entity: { ...selectedEntity, bottomHalfSteps } })} /></label>
            <div class="coordinate-fields"><label>X<CommitNumberInput value={selectedEntity.coordinate.x} onCommit={(x) => dispatch({ type: "updateEntity", originalId: selectedEntity.id, entity: { ...selectedEntity, coordinate: { ...selectedEntity.coordinate, x } } })} /></label><label>Y<CommitNumberInput value={selectedEntity.coordinate.y} onCommit={(y) => dispatch({ type: "updateEntity", originalId: selectedEntity.id, entity: { ...selectedEntity, coordinate: { ...selectedEntity.coordinate, y } } })} /></label></div>
            <button type="button" class="remove-control" onClick={() => dispatch({ type: "removeEntity", id: selectedEntity.id })}>Remove entity</button>
          </div>
        )}
      </section>
    </div>
  );
}

function IssuePanel({ validation, selectedKey, dispatch }: { validation: ValidationState; selectedKey: string; dispatch: (action: any) => void }) {
  return (
    <section class="issue-panel" aria-live="polite">
      <div class="section-heading"><h3>Engine issues</h3><span>{validation.issues.length}</span></div>
      {validation.status === "valid" && <p class="valid-message">Ready to export or playtest.</p>}
      {validation.status !== "valid" && validation.issues.length === 0 && <p class="empty-state">{validation.message}</p>}
      {validation.issues.length > 0 && (
        <ol>
          {validation.issues.map((issue, index) => {
            const coordinate = issueCoordinate(issue);
            const key = coordinate ? coordinateKey(coordinate) : null;
            return <li key={`${issue.code}-${key ?? "global"}-${issue.entityId ?? "0"}-${index}`} class={key === selectedKey ? "is-current" : ""}><button type="button" onClick={() => coordinate && dispatch({ type: "select", coordinate })}><strong>{humanIssue(issue.code)}</strong>{key && <span>cell {key}</span>}{issue.entityId && issue.entityId !== "0" && <span>entity {issue.entityId}</span>}</button></li>;
          })}
        </ol>
      )}
    </section>
  );
}

function NewLevelDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (document: ReturnType<typeof createLevel>, name: string) => void }) {
  const [name, setName] = useState("Untitled level");
  const [width, setWidth] = useState(10);
  const [height, setHeight] = useState(8);
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const [elevation, setElevation] = useState(0);
  const [positiveX, setPositiveX] = useState<AxisX>("east");
  const [positiveY, setPositiveY] = useState<AxisY>("north");
  return <Modal title="Create a new level" onClose={onClose}><div class="dialog-grid"><label class="wide-field">Display name<input value={name} onInput={(event) => setName(event.currentTarget.value)} autofocus /></label><label>Width<input type="number" min="1" max={MAX_BOARD_SIZE} value={width} onInput={(event) => setWidth(event.currentTarget.valueAsNumber)} /></label><label>Height<input type="number" min="1" max={MAX_BOARD_SIZE} value={height} onInput={(event) => setHeight(event.currentTarget.valueAsNumber)} /></label><label>Origin X<input type="number" value={originX} onInput={(event) => setOriginX(event.currentTarget.valueAsNumber)} /></label><label>Origin Y<input type="number" value={originY} onInput={(event) => setOriginY(event.currentTarget.valueAsNumber)} /></label><label>Positive X<select value={positiveX} onChange={(event) => setPositiveX(event.currentTarget.value as AxisX)}><option>east</option><option>west</option></select></label><label>Positive Y<select value={positiveY} onChange={(event) => setPositiveY(event.currentTarget.value as AxisY)}><option>north</option><option>south</option></select></label><label class="wide-field">Default elevation<input type="number" value={elevation} onInput={(event) => setElevation(event.currentTarget.valueAsNumber)} /></label></div><p class="dialog-note">Creates a complete flat grid and places player ID 1 at the origin.</p><div class="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" class="primary-control" onClick={() => onCreate(createLevel({ width, height, originX, originY, positiveX, positiveY, elevation }), name.trim() || "Untitled level")}>Create level</button></div></Modal>;
}

function ResizeDialog({ state, onClose, dispatch }: { state: ReturnType<typeof initialEditorState>; onClose: () => void; dispatch: (action: any) => void }) {
  const [width, setWidth] = useState(state.document.width);
  const [height, setHeight] = useState(state.document.height);
  const [anchor, setAnchor] = useState<ResizeAnchor>("min-min");
  const [elevation, setElevation] = useState(0);
  const shrinking = width < state.document.width || height < state.document.height;
  const preview = resizeDocument(state.document, width, height, anchor, elevation);
  const removedFixtures = Object.keys(state.document.fixtures).length - Object.keys(preview.fixtures).length;
  const removedEntities = Object.keys(state.document.entities).length - Object.keys(preview.entities).length;
  return <Modal title="Resize grid" onClose={onClose}><div class="dialog-grid"><label>Width<input type="number" min="1" max={MAX_BOARD_SIZE} value={width} onInput={(event) => setWidth(event.currentTarget.valueAsNumber)} /></label><label>Height<input type="number" min="1" max={MAX_BOARD_SIZE} value={height} onInput={(event) => setHeight(event.currentTarget.valueAsNumber)} /></label><label class="wide-field">Anchor<select value={anchor} onChange={(event) => setAnchor(event.currentTarget.value as ResizeAnchor)}><option value="min-min">Minimum X / minimum Y</option><option value="center-center">Center</option><option value="max-max">Maximum X / maximum Y</option><option value="min-max">Minimum X / maximum Y</option><option value="max-min">Maximum X / minimum Y</option><option value="center-min">Center X / minimum Y</option><option value="center-max">Center X / maximum Y</option><option value="min-center">Minimum X / center Y</option><option value="max-center">Maximum X / center Y</option></select></label><label class="wide-field">New-cell elevation<input type="number" value={elevation} onInput={(event) => setElevation(event.currentTarget.valueAsNumber)} /></label></div>{shrinking && <p class="warning-note">This retains {preview.width * preview.height} cells and removes {removedFixtures} fixture{removedFixtures === 1 ? "" : "s"} and {removedEntities} entit{removedEntities === 1 ? "y" : "ies"} outside the rectangle. Undo can restore them.</p>}<div class="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" class="primary-control" onClick={() => { dispatch({ type: "resize", width, height, anchor, elevation }); onClose(); }}>Resize grid</button></div></Modal>;
}

function CoordinateDialog({ state, onClose, dispatch }: { state: ReturnType<typeof initialEditorState>; onClose: () => void; dispatch: (action: any) => void }) {
  const [x, setX] = useState(state.document.coordinateSystem.origin.x);
  const [y, setY] = useState(state.document.coordinateSystem.origin.y);
  const [positiveX, setPositiveX] = useState(state.document.coordinateSystem.positiveX);
  const [positiveY, setPositiveY] = useState(state.document.coordinateSystem.positiveY);
  return <Modal title="Coordinate system" onClose={onClose}><div class="dialog-grid"><label>Origin X<input type="number" value={x} onInput={(event) => setX(event.currentTarget.valueAsNumber)} /></label><label>Origin Y<input type="number" value={y} onInput={(event) => setY(event.currentTarget.valueAsNumber)} /></label><label>Positive X<select value={positiveX} onChange={(event) => setPositiveX(event.currentTarget.value as AxisX)}><option>east</option><option>west</option></select></label><label>Positive Y<select value={positiveY} onChange={(event) => setPositiveY(event.currentTarget.value as AxisY)}><option>north</option><option>south</option></select></label></div><p class="dialog-note">Changing the origin translates every cell, fixture, and entity. Axis changes alter cardinal orientation without rewriting coordinates.</p><div class="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" class="primary-control" onClick={() => { dispatch({ type: "translate", origin: { x: toInteger(x), y: toInteger(y) }, positiveX, positiveY }); onClose(); }}>Apply coordinates</button></div></Modal>;
}

function Modal({ title, children, onClose }: { title: string; children: preact.ComponentChildren; onClose: () => void }) {
  return <div class="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section class="modal" role="dialog" aria-modal="true" aria-label={title}><div class="modal-heading"><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}>×</button></div>{children}</section></div>;
}

export function CommitNumberInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    if (Number.isFinite(number)) onCommit(Math.trunc(number));
    else setDraft(String(value));
  };
  return <input type="number" value={draft} onInput={(event) => setDraft(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }} />;
}

function CommitTextInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => onCommit(draft.trim());
  return <input value={draft} onInput={(event) => setDraft(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }} />;
}

export function ColorPicker({ value, onChange }: { value: FixtureColor; onChange: (value: FixtureColor) => void }) {
  return <fieldset class="color-picker"><legend>Color</legend>{COLOR_OPTIONS.map((color) => <button key={color} type="button" class={`color-${color} ${value === color ? "is-selected" : ""}`} aria-label={color} aria-pressed={value === color} onClick={() => onChange(color)} />)}</fieldset>;
}

function handleCellKeyDown(event: KeyboardEvent, coordinate: Coordinate, state: ReturnType<typeof initialEditorState>, dispatch: (action: any) => void) {
  if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    const next = screenNeighbor(state.document, coordinate, event.key as any);
    if (next) {
      dispatch({ type: "select", coordinate: next });
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-coordinate="${coordinateKey(next)}"]`)?.focus());
    }
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    dispatch({ type: state.tool.kind === "select" ? "select" : "applyTool", coordinate });
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    dispatch({ type: "deleteSelected" });
  }
}

function validationFromResult(result: EngineLoadResult): ValidationState {
  if (result.status === "loaded") return { status: "valid", issues: [], message: "Engine valid" };
  if (result.status === "invalid_level") {
    const issues = result.errors ?? [];
    return { status: "invalid", issues, message: `${issues.length} engine issue${issues.length === 1 ? "" : "s"}` };
  }
  return { status: "invalid", issues: [], message: formatJsonError(result.error) };
}

function formatJsonError(error?: EngineJsonError): string {
  if (!error) return "The engine rejected this level document.";
  const location = error.path ? ` at ${error.path}` : error.byteOffset ? ` near byte ${error.byteOffset}` : "";
  return `${humanIssue(error.code)}${location}.`;
}

function safeLoadDraft() {
  try { return loadDraft(localStorage); } catch { return null; }
}

function safeFilename(name: string) {
  return (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "level").slice(0, 80);
}

function validEntityId(id: string) {
  if (!/^[1-9][0-9]{0,19}$/.test(id)) return false;
  try { return BigInt(id) <= 18_446_744_073_709_551_615n; } catch { return false; }
}

function formatHalfSteps(value: number) {
  return `${value}/2 (z${value / 2})`;
}

function fixtureLabel(fixture: FixtureKind) {
  return fixture.type === "exit" ? "EXIT" : fixture.type === "switch" ? "SW" : "DOOR";
}

function cellDescription(coordinate: Coordinate, geometry: CellGeometry, fixture: FixtureKind | undefined, entities: Entity[]) {
  const height = geometry.type === "flat" ? geometry.elevation : geometry.lowElevation + 0.5;
  return `Cell ${coordinateKey(coordinate)}, ${geometry.type} at z${height}${fixture ? `, ${fixture.type}` : ""}, ${entities.length} entities`;
}

function toolHelp(kind: ToolKind) {
  return ({
    select: "Inspect a cell without changing it.",
    player: "Moves the existing player to the stack top.",
    box: "Adds a box at the stack top.",
    barrel: "Adds a barrel at the stack top.",
    exit: "Replaces the fixture with an exit.",
    eraser: "Removes the top entity, then fixture, then resets terrain.",
    flat: "",
    ramp: "",
    switch: "",
    door: "",
  })[kind];
}

function humanIssue(code: string) {
  const labels: Record<string, string> = {
    invalid_dimensions: "Invalid grid dimensions",
    invalid_coordinate_system: "Invalid coordinate system",
    cell_count_mismatch: "Grid cells are incomplete",
    cell_out_of_bounds: "Cell lies outside the grid",
    duplicate_cell: "Duplicate cell",
    invalid_cell_height: "Cell height is out of range",
    invalid_ramp_direction: "Ramp direction is invalid",
    invalid_ramp_endpoints: "Ramp needs matching low and high flat neighbors",
    fixture_out_of_bounds: "Fixture lies outside the grid",
    fixture_on_ramp: "Fixtures require flat terrain",
    duplicate_fixture: "Multiple fixtures share a cell",
    invalid_fixture_color: "Fixture color is invalid",
    entity_out_of_bounds: "Entity lies outside the grid",
    duplicate_entity_id: "Entity ID is duplicated",
    invalid_entity_kind: "Entity type is invalid",
    entity_below_surface: "Entity intersects the terrain",
    overlapping_entities: "Entities overlap in this stack",
    player_not_top_of_stack: "Player must be at the top of its stack",
    player_count_not_one: "Level must contain exactly one player",
    invalid_teleporter_occupancy: "Exit occupancy is invalid",
    invalid_entity_id: "Entity ID is invalid",
    invalid_json: "Invalid JSON",
  };
  return labels[code] ?? code.replaceAll("_", " ");
}

function issueCoordinate(issue: EngineValidationError): Coordinate | null {
  if (["invalid_dimensions", "invalid_coordinate_system", "cell_count_mismatch", "player_count_not_one"].includes(issue.code)) {
    return null;
  }
  return issue.coordinate ?? null;
}

const appRoot = document.querySelector("#app");
if (appRoot) render(<App />, appRoot);
