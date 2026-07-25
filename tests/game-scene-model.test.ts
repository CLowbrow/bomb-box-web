import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ENTITY_HEIGHTS,
  SCENE_UNITS,
  cellSurfaceRange,
  coordinateToWorld,
  entityTransform,
  rampCornerHeights,
  terrainBaselineElevation,
  terrainColumnSegments,
} from "../site/game/scene-model.js";
import {
  BOX_VISUAL_HEIGHT,
  addRoughTextureShader,
  createExitLabel,
  createLedgeGeometry,
  createRampGeometry,
  createWaterMaterial,
  waterFootprintForCamera,
} from "../site/game/three-view.js";

function world(positiveX = "east", positiveY = "north") {
  return {
    coordinateSystem: { origin: { x: 10, y: -4 }, positiveX, positiveY },
    width: 3,
    height: 2,
  };
}

describe("three-dimensional game scene mapping", () => {
  it("uses narrow horizontal seams between floor blocks", () => {
    expect(SCENE_UNITS.grid - SCENE_UNITS.floorSize).toBeCloseTo(0.05);
  });

  it("leaves a legible vertical gap between stacked box visuals", () => {
    expect(SCENE_UNITS.levelHeight - BOX_VISUAL_HEIGHT).toBeCloseTo(0.06);
  });

  it("outlines the outer map perimeter without outlining shared flat edges", () => {
    const cells = [
      { coordinate: { x: 10, y: -4 }, type: "flat", elevation: 0 },
      { coordinate: { x: 11, y: -4 }, type: "flat", elevation: 0 },
    ];
    const geometry = createLedgeGeometry(cells, { ...world(), width: 2, height: 1 });

    expect(geometry.getAttribute("instanceStart").count).toBe(6);
    geometry.dispose();
  });

  it("maps authored axes to screen-right east and screen-up north", () => {
    expect(coordinateToWorld({ x: 10, y: -4 }, world())).toEqual({ x: -1, z: 0.5 });
    expect(coordinateToWorld({ x: 12, y: -3 }, world())).toEqual({ x: 1, z: -0.5 });
    expect(coordinateToWorld({ x: 10, y: -4 }, world("west", "south"))).toEqual({ x: 1, z: -0.5 });
    expect(coordinateToWorld({ x: 12, y: -3 }, world("west", "south"))).toEqual({ x: -1, z: 0.5 });
  });

  it("uses one compressed level for floors, boxes, and barrels", () => {
    expect(SCENE_UNITS.levelHeight).toBe(0.65);
    expect(SCENE_UNITS.halfStep).toBe(0.325);
    expect(ENTITY_HEIGHTS.box).toBe(0.65);
    expect(ENTITY_HEIGHTS.barrel).toBe(0.65);
    expect(ENTITY_HEIGHTS.player).toBeGreaterThan(0.65);
    expect(SCENE_UNITS.doorHeight).toBeGreaterThan(0.65);

    const box = entityTransform({
      id: "1",
      type: "box",
      coordinate: { x: 10, y: -4 },
      bottomHalfSteps: -2,
    }, world());
    const barrel = entityTransform({
      id: "2",
      type: "barrel",
      coordinate: { x: 10, y: -4 },
      bottomHalfSteps: 0,
    }, world());
    expect(box.y).toBe(-0.65);
    expect(box.y + box.height).toBe(barrel.y);
  });

  it("maps flat and ramp elevations using the same vertical scale", () => {
    expect(cellSurfaceRange({ type: "flat", elevation: -2 })).toEqual({ low: -1.3, high: -1.3 });
    const ramp = cellSurfaceRange({ type: "ramp", lowElevation: 2 });
    expect(ramp.low).toBeCloseTo(1.3);
    expect(ramp.high).toBeCloseTo(1.95);
  });

  it("orients each ramp's low edge in cardinal world space", () => {
    expect(rampCornerHeights("north")).toEqual([0, 0, 0.65, 0.65]);
    expect(rampCornerHeights("south")).toEqual([0.65, 0.65, 0, 0]);
    expect(rampCornerHeights("east")).toEqual([0.65, 0, 0, 0.65]);
    expect(rampCornerHeights("west")).toEqual([0, 0.65, 0.65, 0]);
  });

  it("keeps ramp faces faceted so side normals cannot distort the slope", () => {
    const geometry = createRampGeometry("north");
    const normals = geometry.getAttribute("normal");
    const topNormals = Array.from({ length: 6 }, (_, index) => [
      normals.getX(index),
      normals.getY(index),
      normals.getZ(index),
    ]);

    expect(geometry.index).toBeNull();
    for (const normal of topNormals.slice(1)) {
      expect(normal).toEqual(topNormals[0]);
    }
    geometry.dispose();
  });

  it("uses a time-driven water shader with an accessible static state", () => {
    const material = createWaterMaterial();

    expect(material.uniforms.uTime.value).toBe(0);
    expect(material.vertexShader).toContain("uTime");
    expect(material.vertexShader).toContain("displaced.z += wave");
    expect(material.fragmentShader).toContain("slowRipple");
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);

    material.dispose();
  });

  it("adds subtle procedural roughness to standard materials", () => {
    const material = addRoughTextureShader(new THREE.MeshStandardMaterial());
    const shader = {
      vertexShader: "#include <common>\n#include <project_vertex>",
      fragmentShader: "#include <common>\n#include <roughnessmap_fragment>",
    };

    material.onBeforeCompile(shader, null);

    expect(shader.vertexShader).toContain("vRoughTexturePosition = position");
    expect(shader.fragmentShader).toContain("roughTextureNoise");
    expect(shader.fragmentShader).toContain("roughnessFactor = clamp");
    expect(material.customProgramCacheKey()).toContain("subtle-rough-texture");
    material.dispose();
  });

  it("keeps the raised three-dimensional exit label inside one floor tile", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const label = createExitLabel(geometry, material);
    const bounds = new THREE.Box3().setFromObject(label);
    const size = bounds.getSize(new THREE.Vector3());

    expect(label.children).toHaveLength(4);
    expect(size.x).toBeGreaterThan(0.7);
    expect(size.x).toBeLessThan(SCENE_UNITS.floorSize);
    expect(size.z).toBeLessThan(SCENE_UNITS.floorSize);
    expect(size.y).toBeCloseTo(0.35);
    expect(bounds.min.y).toBeGreaterThan(0.3);

    geometry.dispose();
    material.dispose();
  });

  it("projects the camera frustum onto the water plane", () => {
    const camera = new THREE.PerspectiveCamera(34, 2, 0.1, 1000);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);

    const footprint = waterFootprintForCamera(camera, 0);

    expect(footprint).not.toBeNull();
    expect(footprint.width).toBeGreaterThan(footprint.depth);
    expect(footprint.depth).toBeGreaterThan(0);
    expect(footprint.centerZ).toBeLessThan(0);
  });

  it("builds elevated terrain upward from a shared half-step baseline", () => {
    const cells = [
      { type: "flat", elevation: 0 },
      { type: "flat", elevation: 3 },
      { type: "ramp", lowElevation: 1 },
    ];
    const baseline = terrainBaselineElevation(cells);
    expect(baseline).toBe(-0.5);
    expect(terrainColumnSegments(0, baseline)).toEqual([
      { bottom: -0.325, top: 0 },
    ]);

    const tallColumn = terrainColumnSegments(3, baseline);
    expect(tallColumn).toHaveLength(4);
    expect(tallColumn[0]).toEqual({ bottom: -0.325, top: 0 });
    expect(tallColumn[1]).toEqual({ bottom: 0.025, top: 0.65 });
    expect(tallColumn[2].bottom).toBeCloseTo(0.675);
    expect(tallColumn[2].top).toBeCloseTo(1.3);
    expect(tallColumn[3].bottom).toBeCloseTo(1.325);
    expect(tallColumn[3].top).toBeCloseTo(1.95);
  });

  it("extends the shared baseline below negative terrain when present", () => {
    const cells = [
      { type: "flat", elevation: -2 },
      { type: "flat", elevation: 1 },
    ];
    const baseline = terrainBaselineElevation(cells);
    expect(baseline).toBe(-2.5);
    expect(terrainColumnSegments(-2, baseline)).toEqual([
      { bottom: -1.625, top: -1.3 },
    ]);
    expect(terrainColumnSegments(1, baseline)).toHaveLength(4);
  });
});
