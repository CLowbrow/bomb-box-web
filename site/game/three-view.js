import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TICK_DURATION_MS } from "./config.js";
import {
  SCENE_UNITS,
  cellSurfaceRange,
  coordinateKey,
  coordinateToWorld,
  describeDynamicState,
  entityBottomY,
  entityTransform,
  rampCornerHeights,
  terrainBaselineElevation,
  terrainColumnSegments,
} from "./scene-model.js";

const CAMERA_ELEVATION = THREE.MathUtils.degToRad(64);
const CAMERA_FRAMING_FOV = 34;
const CAMERA_FOCAL_LENGTH = 60;
const PLAYER_MODEL_URL = new URL("../models/Gorker.glb", import.meta.url).href;
const WATER_MARGIN = 2.4;
const WATER_FRUSTUM_OVERSCAN = 0.8;
const WATER_DEPTH_OFFSET = 0.36;
const WATER_WAVE_HEIGHT = 0.055;
export const BOX_VISUAL_HEIGHT = SCENE_UNITS.levelHeight - 0.06;
export const BARREL_VISUAL_HEIGHT = BOX_VISUAL_HEIGHT;
export const BARREL_VISUAL_TOP_Y = (SCENE_UNITS.levelHeight + BARREL_VISUAL_HEIGHT) / 2;
export const BARREL_LIP_TUBE_RADIUS = 0.035;
export const BARREL_LIP_CENTER_Y = BARREL_VISUAL_TOP_Y - BARREL_LIP_TUBE_RADIUS;
export const BARREL_SLUDGE_SURFACE_Y = BARREL_LIP_CENTER_Y - 0.012;
const ROUGH_TEXTURE_SCALE = 17;
const ROUGH_TEXTURE_STRENGTH = 0.08;
const TERRAIN_SHADE_PER_LEVEL = 0.08;
const TERRAIN_MAX_SHADE = 0.2;
const LEDGE_EDGE_Y_OFFSET = 0.012;
const LEDGE_HEIGHT_EPSILON = 0.000001;
const LEDGE_LINE_WIDTH = 1.6;
const EXIT_LABEL_BASE_Y = 0.53;
const EXIT_LABEL_COLOR = 0xa77bf3;
const EXIT_LABEL_DEPTH = 0.065;
const EXIT_LABEL_FLOAT_AMPLITUDE = 0.022;
const EXIT_LABEL_FLOAT_PERIOD_MS = 3400;
const EXIT_LABEL_HEIGHT = 0.35;
const EXIT_LABEL_SPACING = 0.03;
const EXIT_LABEL_STROKE = 0.062;
const EXIT_LABEL_WIDTH = 0.16;
export const EXPLOSION_FIRE_DURATION_MS = TICK_DURATION_MS * 1.3;
const LEDGE_EDGES = Object.freeze([
  { dx: 0, dz: -1, corners: [0, 1], neighborCorners: [3, 2] },
  { dx: 1, dz: 0, corners: [1, 2], neighborCorners: [0, 3] },
  { dx: 0, dz: 1, corners: [3, 2], neighborCorners: [0, 1] },
  { dx: -1, dz: 0, corners: [0, 3], neighborCorners: [1, 2] },
]);
const FIXTURE_COLORS = Object.freeze({
  red: 0xc84b3f,
  green: 0x4f9b62,
  blue: 0x477fc2,
  yellow: 0xd6a928,
});

export function fitPlayerModel(model, targetHeight = SCENE_UNITS.playerHeight) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.y <= 0) {
    throw new Error("player model has no measurable height");
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const offset = new THREE.Group();
  offset.position.set(-center.x, -bounds.min.y, -center.z);
  offset.add(model);

  const fitted = new THREE.Group();
  fitted.name = "GorkerPlayerModel";
  fitted.scale.setScalar(targetHeight / size.y);
  fitted.add(offset);
  return fitted;
}

export function playerFacingAngle(fromTransform, toTransform) {
  const dx = toTransform.x - fromTransform.x;
  const dz = toTransform.z - fromTransform.z;
  if (Math.abs(dx) + Math.abs(dz) < Number.EPSILON) return null;

  // Gorker's face is authored toward local +X. Three.js positive Y rotation
  // turns local +X toward negative Z.
  return Math.atan2(-dz, dx);
}

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: new THREE.Vector2(1, 1) },
      uDeepColor: { value: new THREE.Color(0x174d62) },
      uShallowColor: { value: new THREE.Color(0x4aa5a4) },
      uHighlightColor: { value: new THREE.Color(0xb8e1d5) },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec2 uSize;
      varying vec2 vSurfacePosition;
      varying float vWave;

      void main() {
        vec2 surfacePosition = position.xy * uSize;
        float broadWave = sin(surfacePosition.x * 1.18 + uTime * 0.95)
          * cos(surfacePosition.y * 0.82 - uTime * 0.62);
        float crossWave = sin((surfacePosition.x + surfacePosition.y) * 1.72 - uTime * 1.28);
        float wave = (broadWave * 0.68 + crossWave * 0.32) * ${WATER_WAVE_HEIGHT.toFixed(3)};
        vec3 displaced = position;
        displaced.z += wave;
        vSurfacePosition = surfacePosition;
        vWave = wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uHighlightColor;
      varying vec2 vSurfacePosition;
      varying float vWave;

      void main() {
        float slowRipple = sin(vSurfacePosition.x * 1.42 + uTime * 0.7)
          + sin(vSurfacePosition.y * 1.68 - uTime * 0.58);
        float diagonalRipple = sin((vSurfacePosition.x - vSurfacePosition.y) * 2.35 + uTime * 0.92);
        float waterMix = 0.5 + slowRipple * 0.105 + diagonalRipple * 0.055;
        vec3 color = mix(uDeepColor, uShallowColor, clamp(waterMix, 0.0, 1.0));
        float crest = smoothstep(0.018, ${WATER_WAVE_HEIGHT.toFixed(3)}, vWave);
        color = mix(color, uHighlightColor, crest * 0.42);
        gl_FragColor = vec4(color, 0.94);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

export function createExplosionFireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 0.92 },
      uHotColor: { value: new THREE.Color(0xfff4a3) },
      uFlameColor: { value: new THREE.Color(0xff7a18) },
      uEmberColor: { value: new THREE.Color(0xb91d09) },
    },
    vertexShader: `
      uniform float uProgress;
      uniform float uTime;
      varying float vFlame;
      varying vec3 vViewNormal;
      varying vec3 vViewDirection;

      float fireNoise(vec3 point) {
        float broad = sin(point.x * 5.3 + uTime * 17.0)
          * sin(point.y * 6.1 - uTime * 13.0)
          * sin(point.z * 5.7 + uTime * 11.0);
        float detail = sin((point.x + point.y - point.z) * 11.0 - uTime * 23.0);
        return broad * 0.68 + detail * 0.32;
      }

      void main() {
        float flame = fireNoise(normalize(position));
        vec3 displaced = position + normal * flame * (0.035 + uProgress * 0.075);
        vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
        vFlame = flame;
        vViewNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      uniform float uOpacity;
      uniform vec3 uHotColor;
      uniform vec3 uFlameColor;
      uniform vec3 uEmberColor;
      varying float vFlame;
      varying vec3 vViewNormal;
      varying vec3 vViewDirection;

      void main() {
        float facing = max(dot(vViewNormal, vViewDirection), 0.0);
        float rim = pow(1.0 - facing, 1.7);
        float flame = smoothstep(-0.75, 0.8, vFlame);
        float cooling = smoothstep(0.1, 0.9, uProgress);
        vec3 hot = mix(uHotColor, uFlameColor, flame * 0.72 + cooling * 0.28);
        vec3 color = mix(hot, uEmberColor, cooling * (0.25 + flame * 0.55));
        color += uFlameColor * rim * (0.42 + flame * 0.3);
        float alpha = uOpacity * min(1.0, 0.48 + rim * 0.58 + flame * 0.2);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createBarrelSludgeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uDeepColor: { value: new THREE.Color(0x92828a) },
      uSludgeColor: { value: new THREE.Color(0xaa929d) },
      uSheenColor: { value: new THREE.Color(0xc1adb5) },
    },
    vertexShader: `
      varying vec2 vSludgeUv;

      void main() {
        vSludgeUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uDeepColor;
      uniform vec3 uSludgeColor;
      uniform vec3 uSheenColor;
      varying vec2 vSludgeUv;

      float sludgeNoise(vec2 point) {
        float broad = sin(point.x * 9.0 + sin(point.y * 5.0 - uTime * 1.15));
        float cross = sin((point.x - point.y) * 13.0 + uTime * 0.82);
        float curl = cos(length(point - vec2(0.5)) * 24.0 - uTime * 1.3);
        return broad * 0.48 + cross * 0.3 + curl * 0.22;
      }

      float bubbleRing(vec2 center, float radius) {
        float distanceFromRing = abs(length(vSludgeUv - center) - radius);
        return 1.0 - smoothstep(0.008, 0.021, distanceFromRing);
      }

      void main() {
        float radial = length(vSludgeUv - vec2(0.5)) * 2.0;
        float flow = sludgeNoise(vSludgeUv + vec2(uTime * 0.055, -uTime * 0.038));
        float surfaceCurrent = 0.5 + 0.5 * sin(
          vSludgeUv.x * 10.0 - uTime * 1.35
          + sin(vSludgeUv.y * 8.0 + uTime * 0.78)
        );
        float mixture = clamp(0.52 + flow * 0.1 + surfaceCurrent * 0.14, 0.0, 1.0);
        vec3 color = mix(uDeepColor, uSludgeColor, mixture);

        float oilySheen = pow(max(0.0, 0.5 + 0.5 * sin(
          vSludgeUv.x * 18.0 + vSludgeUv.y * 11.0 + flow - uTime * 1.05
        )), 4.0);
        float bubblePulse = 0.5 + 0.5 * sin(uTime * 2.2);
        vec2 bubbleOne = vec2(
          0.34 + sin(uTime * 0.85) * 0.045,
          0.57 + cos(uTime * 0.71) * 0.035
        );
        vec2 bubbleTwo = vec2(
          0.67 + cos(uTime * 0.63) * 0.04,
          0.4 + sin(uTime * 0.76) * 0.045
        );
        float bubbles = bubbleRing(bubbleOne, 0.045 + bubblePulse * 0.02)
          + bubbleRing(bubbleTwo, 0.032 + (1.0 - bubblePulse) * 0.018);
        float movingHighlight = oilySheen * 0.14 + bubbles * 0.24 + surfaceCurrent * 0.04;
        color = mix(color, uSheenColor, clamp(movingHighlight, 0.0, 0.34));
        color *= 1.0 - smoothstep(0.72, 1.0, radial) * 0.06;

        gl_FragColor = vec4(color, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

export function waterFootprintForCamera(camera, waterY) {
  camera.updateMatrixWorld(true);
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -waterY);
  const raycaster = new THREE.Raycaster();
  const intersection = new THREE.Vector3();
  const points = [];

  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    if (!raycaster.ray.intersectPlane(waterPlane, intersection)) return null;
    points.push(intersection.clone());
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

export function createRampGeometry(lowDirection) {
  const half = SCENE_UNITS.floorSize / 2;
  const top = rampCornerHeights(lowDirection);
  const overlap = SCENE_UNITS.rampOverlap;
  const positions = new Float32Array([
    -half, top[0], -half,
    half, top[1], -half,
    half, top[2], half,
    -half, top[3], half,
    -half, -overlap, -half,
    half, -overlap, -half,
    half, -overlap, half,
    -half, -overlap, half,
  ]);
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const facetedGeometry = geometry.toNonIndexed();
  geometry.dispose();
  facetedGeometry.computeVertexNormals();
  return facetedGeometry;
}

function disposeRecord(record) {
  for (const material of record.materials) material.dispose();
}

function disposePlayerModelTemplate(template) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  template?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of objectMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function clonePlayerModel(template) {
  const model = template.clone(true);
  const materialClones = new Map();
  model.traverse((object) => {
    if (!object.isMesh) return;
    const cloneMaterial = (material) => {
      if (!materialClones.has(material)) materialClones.set(material, material.clone());
      return materialClones.get(material);
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material);
  });
  return { model, materials: [...materialClones.values()] };
}

function setMaterialOpacity(material, opacity) {
  material.opacity = opacity;
  if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = opacity;
  material.transparent = opacity < 1;
  material.depthWrite = opacity > 0.98;
}

function stateSet(values, key = (value) => value) {
  return new Set((values ?? []).map(key));
}

function addExitLabelStroke(group, geometry, material, x, y, width, height, rotation = 0) {
  const stroke = new THREE.Mesh(geometry, material);
  stroke.position.set(x, y, 0);
  stroke.rotation.z = rotation;
  stroke.scale.set(width, height, EXIT_LABEL_DEPTH);
  group.add(stroke);
}

function createExitLabelLetter(letter, geometry, material) {
  const group = new THREE.Group();
  const capY = (EXIT_LABEL_HEIGHT - EXIT_LABEL_STROKE) / 2;
  const stemX = (-EXIT_LABEL_WIDTH + EXIT_LABEL_STROKE) / 2;
  let strokes;

  if (letter === "E") {
    strokes = [
      [stemX, 0, EXIT_LABEL_STROKE, EXIT_LABEL_HEIGHT],
      ...[-capY, 0, capY].map((y) => [0, y, EXIT_LABEL_WIDTH, EXIT_LABEL_STROKE]),
    ];
  } else if (letter === "X") {
    let diagonalAngle = Math.atan2(EXIT_LABEL_WIDTH, EXIT_LABEL_HEIGHT);
    for (let index = 0; index < 6; index += 1) {
      const centerlineWidth = EXIT_LABEL_WIDTH
        - EXIT_LABEL_STROKE * Math.cos(diagonalAngle);
      const centerlineHeight = EXIT_LABEL_HEIGHT
        - EXIT_LABEL_STROKE * Math.sin(diagonalAngle);
      diagonalAngle = Math.atan2(centerlineWidth, centerlineHeight);
    }
    const diagonalLength = (EXIT_LABEL_HEIGHT
      - EXIT_LABEL_STROKE * Math.sin(diagonalAngle))
      / Math.cos(diagonalAngle);
    strokes = [
      [0, 0, EXIT_LABEL_STROKE, diagonalLength, diagonalAngle],
      [0, 0, EXIT_LABEL_STROKE, diagonalLength, -diagonalAngle],
    ];
  } else if (letter === "I") {
    strokes = [
      [0, 0, EXIT_LABEL_STROKE, EXIT_LABEL_HEIGHT],
      ...[-capY, capY].map((y) => [0, y, EXIT_LABEL_WIDTH, EXIT_LABEL_STROKE]),
    ];
  } else if (letter === "T") {
    strokes = [
      [0, 0, EXIT_LABEL_STROKE, EXIT_LABEL_HEIGHT],
      [0, capY, EXIT_LABEL_WIDTH, EXIT_LABEL_STROKE],
    ];
  }

  for (const [x, y, width, height, rotation] of strokes ?? []) {
    addExitLabelStroke(group, geometry, material, x, y, width, height, rotation);
  }

  return group;
}

export function createExitLabel(geometry, material) {
  const label = new THREE.Group();
  const letters = [..."EXIT"];
  const wordWidth = letters.length * EXIT_LABEL_WIDTH
    + (letters.length - 1) * EXIT_LABEL_SPACING;
  let x = -wordWidth / 2 + EXIT_LABEL_WIDTH / 2;

  for (const letter of letters) {
    const letterGroup = createExitLabelLetter(letter, geometry, material);
    letterGroup.position.x = x;
    label.add(letterGroup);
    x += EXIT_LABEL_WIDTH + EXIT_LABEL_SPACING;
  }

  label.position.y = EXIT_LABEL_BASE_Y;
  return label;
}

export function addRoughTextureShader(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vRoughTexturePosition;`,
      )
      .replace(
        "#include <project_vertex>",
        `vRoughTexturePosition = position;
        #include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vRoughTexturePosition;

        float roughTextureNoise(vec3 point) {
          vec3 cell = floor(point);
          vec3 blend = fract(point);
          blend = blend * blend * (3.0 - 2.0 * blend);
          vec3 stepVector = vec3(1.0, 57.0, 113.0);
          float base = dot(cell, stepVector);
          vec4 lower = fract(sin(base + vec4(0.0, 1.0, 57.0, 58.0)) * 43758.5453);
          vec4 upper = fract(sin(base + vec4(113.0, 114.0, 170.0, 171.0)) * 43758.5453);
          vec4 mixedZ = mix(lower, upper, blend.z);
          vec2 mixedY = mix(mixedZ.xy, mixedZ.zw, blend.y);
          return mix(mixedY.x, mixedY.y, blend.x);
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float roughTexture = roughTextureNoise(vRoughTexturePosition * ${ROUGH_TEXTURE_SCALE.toFixed(1)});
        roughnessFactor = clamp(
          roughnessFactor + (roughTexture - 0.5) * ${ROUGH_TEXTURE_STRENGTH.toFixed(2)},
          0.0,
          1.0
        );
        diffuseColor.rgb *= 0.985 + roughTexture * 0.03;`,
      );
  };
  material.customProgramCacheKey = () => "subtle-rough-texture-v1";
  return material;
}

function terrainSurfaceElevation(cell) {
  return cell.type === "ramp" ? cell.lowElevation + 0.5 : cell.elevation;
}

function terrainShade(elevation, lowestElevation) {
  const darkness = THREE.MathUtils.clamp(
    (elevation - lowestElevation) * TERRAIN_SHADE_PER_LEVEL,
    0,
    TERRAIN_MAX_SHADE,
  );
  return new THREE.Color().setRGB(1 - darkness, 1 - darkness, 1 - darkness);
}

function cellCornerWorldHeights(cell) {
  if (cell.type !== "ramp") {
    const height = cell.elevation * SCENE_UNITS.levelHeight;
    return [height, height, height, height];
  }
  const lowY = cell.lowElevation * SCENE_UNITS.levelHeight;
  return rampCornerHeights(cell.lowDirection).map((height) => lowY + height);
}

export function createLedgeGeometry(cells, fullState) {
  const half = SCENE_UNITS.floorSize / 2;
  const maxWorldX = (fullState.width - 1) / 2;
  const maxWorldZ = (fullState.height - 1) / 2;
  const byWorldPosition = new Map(cells.map((cell) => {
    const position = coordinateToWorld(cell.coordinate, fullState);
    return [`${position.x},${position.z}`, { cell, position }];
  }));
  const positions = [];

  for (const { cell, position } of byWorldPosition.values()) {
    const heights = cellCornerWorldHeights(cell);
    for (const edge of LEDGE_EDGES) {
      const y1 = heights[edge.corners[0]];
      const y2 = heights[edge.corners[1]];
      const neighborX = position.x + edge.dx;
      const neighborZ = position.z + edge.dz;
      const neighbor = byWorldPosition.get(`${neighborX},${neighborZ}`);
      const outsideMap = Math.abs(neighborX) > maxWorldX + LEDGE_HEIGHT_EPSILON
        || Math.abs(neighborZ) > maxWorldZ + LEDGE_HEIGHT_EPSILON;
      if (!neighbor && !outsideMap) continue;

      const x1 = position.x + (edge.dx === 0 ? -half : edge.dx * half);
      const z1 = position.z + (edge.dz === 0 ? -half : edge.dz * half);
      const x2 = position.x + (edge.dx === 0 ? half : edge.dx * half);
      const z2 = position.z + (edge.dz === 0 ? half : edge.dz * half);
      let start = 0;
      let end = 1;
      if (neighbor) {
        const neighborHeights = cellCornerWorldHeights(neighbor.cell);
        const difference1 = y1 - neighborHeights[edge.neighborCorners[0]];
        const difference2 = y2 - neighborHeights[edge.neighborCorners[1]];
        if (difference1 <= LEDGE_HEIGHT_EPSILON && difference2 <= LEDGE_HEIGHT_EPSILON) continue;
        if (difference1 <= LEDGE_HEIGHT_EPSILON || difference2 <= LEDGE_HEIGHT_EPSILON) {
          const crossing = difference1 / (difference1 - difference2);
          if (difference1 <= LEDGE_HEIGHT_EPSILON) start = crossing;
          if (difference2 <= LEDGE_HEIGHT_EPSILON) end = crossing;
        }
      }
      positions.push(
        THREE.MathUtils.lerp(x1, x2, start),
        THREE.MathUtils.lerp(y1, y2, start) + LEDGE_EDGE_Y_OFFSET,
        THREE.MathUtils.lerp(z1, z2, start),
        THREE.MathUtils.lerp(x1, x2, end),
        THREE.MathUtils.lerp(y1, y2, end) + LEDGE_EDGE_Y_OFFSET,
        THREE.MathUtils.lerp(z1, z2, end),
      );
    }
  }

  if (!positions.length) return null;
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  return geometry;
}

export function createGameView(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdedbd2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.replaceChildren(renderer.domElement);
  container.setAttribute("role", "img");

  const camera = new THREE.PerspectiveCamera(CAMERA_FRAMING_FOV, 1, 0.1, 10000);
  camera.setFocalLength(CAMERA_FOCAL_LENGTH);
  const terrainRoot = new THREE.Group();
  const fixtureRoot = new THREE.Group();
  const entityRoot = new THREE.Group();
  const effectRoot = new THREE.Group();
  const waterGeometry = new THREE.PlaneGeometry(1, 1, 56, 56);
  const waterMaterial = createWaterMaterial();
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.visible = false;
  scene.add(water, terrainRoot, fixtureRoot, entityRoot, effectRoot);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777164, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
  keyLight.position.set(-6, 12, 8);
  scene.add(keyLight);

  const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9290, roughness: 0.88 });
  const ledgeMaterial = new LineMaterial({
    color: 0x252a29,
    linewidth: LEDGE_LINE_WIDTH,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const geometries = {
    terrainBlock: new THREE.BoxGeometry(SCENE_UNITS.floorSize, 1, SCENE_UNITS.floorSize),
    north: createRampGeometry("north"),
    east: createRampGeometry("east"),
    south: createRampGeometry("south"),
    west: createRampGeometry("west"),
    box: new THREE.BoxGeometry(SCENE_UNITS.boxSize, BOX_VISUAL_HEIGHT, SCENE_UNITS.boxSize),
    barrel: new THREE.CylinderGeometry(
      SCENE_UNITS.barrelDiameter / 2,
      SCENE_UNITS.barrelDiameter / 2,
      BARREL_VISUAL_HEIGHT,
      20,
      1,
      true,
    ),
    barrelBottom: new THREE.CircleGeometry(SCENE_UNITS.barrelDiameter / 2, 24),
    barrelLip: new THREE.TorusGeometry(
      SCENE_UNITS.barrelDiameter / 2 - BARREL_LIP_TUBE_RADIUS,
      BARREL_LIP_TUBE_RADIUS,
      8,
      32,
    ),
    barrelSludge: new THREE.CircleGeometry(
      SCENE_UNITS.barrelDiameter / 2 - BARREL_LIP_TUBE_RADIUS * 1.9,
      40,
    ),
    barrelBand: new THREE.TorusGeometry(SCENE_UNITS.barrelDiameter / 2 + 0.012, 0.035, 6, 24),
    playerBody: new THREE.ConeGeometry(0.31, 0.62, 16),
    playerHead: new THREE.SphereGeometry(0.17, 16, 10),
    switch: new THREE.CylinderGeometry(0.27, 0.27, 0.08, 24),
    door: new THREE.BoxGeometry(0.7, SCENE_UNITS.doorHeight, 0.7),
    exit: new THREE.TorusGeometry(0.31, 0.055, 8, 28),
    exitLabelStroke: new THREE.BoxGeometry(1, 1, 1),
    blast: new THREE.SphereGeometry(0.34, 14, 10),
    explosionFire: new THREE.SphereGeometry(0.34, 24, 18),
  };
  geometries.barrelBottom.rotateX(Math.PI / 2);
  geometries.barrelLip.rotateX(Math.PI / 2);
  geometries.barrelSludge.rotateX(-Math.PI / 2);
  geometries.barrelBand.rotateX(Math.PI / 2);
  geometries.exit.rotateX(Math.PI / 2);

  const entityRecords = new Map();
  const fixtureRecords = [];
  let currentState = null;
  let world = null;
  let disposed = false;
  let animationGeneration = 0;
  let resizeObserver;
  let minWorldY = 0;
  let maxWorldY = SCENE_UNITS.levelHeight;
  let waterAnimationFrame = 0;
  let ledgeGeometry = null;
  let playerModelTemplate = null;
  const activeFireEffects = new Set();

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  new GLTFLoader().loadAsync(PLAYER_MODEL_URL).then(({ scene: playerScene }) => {
    const template = fitPlayerModel(playerScene);
    if (disposed) {
      disposePlayerModelTemplate(template);
      return;
    }
    playerModelTemplate = template;
    for (const record of entityRecords.values()) installPlayerModel(record);
    render();
  }).catch((error) => {
    if (!disposed) console.warn("[Bomb Box] Could not load the player model.", error);
  });

  function render() {
    if (!disposed) renderer.render(scene, camera);
  }

  function removeFireEffect(effect) {
    effectRoot.remove(effect.mesh);
    effect.material.dispose();
    activeFireEffects.delete(effect);
  }

  function clearFireEffects() {
    for (const effect of [...activeFireEffects]) removeFireEffect(effect);
  }

  function updateFireEffects(time) {
    for (const effect of [...activeFireEffects]) {
      const progress = THREE.MathUtils.clamp(
        (time - effect.startTime) / EXPLOSION_FIRE_DURATION_MS,
        0,
        1,
      );
      const expansion = 1 - (1 - progress) ** 3;
      effect.mesh.scale.setScalar(THREE.MathUtils.lerp(0.18, 2.55, expansion));
      effect.mesh.rotation.y = progress * 1.8;
      effect.mesh.rotation.z = progress * 0.7;
      effect.material.uniforms.uProgress.value = progress;
      effect.material.uniforms.uTime.value = time * 0.001;
      effect.material.uniforms.uOpacity.value = 0.92 * (1 - progress) ** 1.15;
      if (progress >= 1) removeFireEffect(effect);
    }
  }

  function fitWaterToCamera() {
    if (!world || !water.visible) return;
    const footprint = waterFootprintForCamera(camera, water.position.y);
    if (!footprint) return;
    const minimumWidth = world.width * SCENE_UNITS.grid + WATER_MARGIN * 2;
    const minimumDepth = world.height * SCENE_UNITS.grid + WATER_MARGIN * 2;
    const width = Math.max(minimumWidth, footprint.width + WATER_FRUSTUM_OVERSCAN * 2);
    const depth = Math.max(minimumDepth, footprint.depth + WATER_FRUSTUM_OVERSCAN * 2);
    water.position.x = footprint.centerX;
    water.position.z = footprint.centerZ;
    water.scale.set(width, depth, 1);
    waterMaterial.uniforms.uSize.value.set(width, depth);
  }

  function animateWater(time) {
    waterAnimationFrame = 0;
    if (disposed || reducedMotion?.matches) return;
    updateFireEffects(time);
    waterMaterial.uniforms.uTime.value = time * 0.001;
    for (const record of entityRecords.values()) {
      if (record.sludgeMaterial) record.sludgeMaterial.uniforms.uTime.value = time * 0.001;
    }
    const exitOffset = Math.sin(time * Math.PI * 2 / EXIT_LABEL_FLOAT_PERIOD_MS)
      * EXIT_LABEL_FLOAT_AMPLITUDE;
    for (const record of fixtureRecords) {
      if (record.type === "exit") {
        record.label.position.y = EXIT_LABEL_BASE_Y + exitOffset;
      }
    }
    render();
    waterAnimationFrame = requestAnimationFrame(animateWater);
  }

  function syncWaterAnimation() {
    if (reducedMotion?.matches) {
      if (waterAnimationFrame) cancelAnimationFrame(waterAnimationFrame);
      waterAnimationFrame = 0;
      clearFireEffects();
      waterMaterial.uniforms.uTime.value = 0;
      for (const record of entityRecords.values()) {
        if (record.sludgeMaterial) record.sludgeMaterial.uniforms.uTime.value = 0;
      }
      for (const record of fixtureRecords) {
        if (record.type === "exit") record.label.position.y = EXIT_LABEL_BASE_Y;
      }
      render();
    } else if (!waterAnimationFrame && !disposed) {
      waterAnimationFrame = requestAnimationFrame(animateWater);
    }
  }

  reducedMotion?.addEventListener?.("change", syncWaterAnimation);
  syncWaterAnimation();

  function fitCamera() {
    if (!world) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);

    const aspect = width / height;
    const horizontalSpan = world.width * SCENE_UNITS.grid + 1.15;
    const depthSpan = world.height * SCENE_UNITS.grid + 1.15;
    const elevationSpan = maxWorldY - minWorldY + 0.9;
    const projectedHeight = depthSpan * Math.sin(CAMERA_ELEVATION)
      + elevationSpan * Math.cos(CAMERA_ELEVATION);
    const viewDepth = depthSpan * Math.cos(CAMERA_ELEVATION)
      + elevationSpan * Math.sin(CAMERA_ELEVATION);
    const halfFrame = Math.max(projectedHeight / 2, horizontalSpan / (2 * aspect));
    const distance = halfFrame / Math.tan(THREE.MathUtils.degToRad(CAMERA_FRAMING_FOV / 2))
      + viewDepth / 2;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    const targetY = (minWorldY + maxWorldY) / 2;
    camera.position.set(
      0,
      targetY + distance * Math.sin(CAMERA_ELEVATION),
      distance * Math.cos(CAMERA_ELEVATION),
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(0, targetY, 0);
    fitWaterToCamera();
    render();
  }

  function clearEntities() {
    for (const record of entityRecords.values()) disposeRecord(record);
    entityRecords.clear();
    entityRoot.clear();
  }

  function clearFixtures() {
    for (const record of fixtureRecords) {
      for (const material of record.materials) material.dispose();
    }
    fixtureRecords.length = 0;
    fixtureRoot.clear();
  }

  function installPlayerModel(record) {
    if (record.entity.type !== "player" || !playerModelTemplate || record.hasPlayerModel) return;
    const { model, materials } = clonePlayerModel(playerModelTemplate);
    for (const child of [...record.group.children]) record.group.remove(child);
    for (const material of record.materials) material.dispose();
    record.materials = materials;
    record.hasPlayerModel = true;
    record.group.add(model);
    for (const material of materials) setMaterialOpacity(material, record.opacity);
  }

  function createEntityRecord(entity) {
    const group = new THREE.Group();
    group.userData.entityId = entity.id;
    group.userData.entityType = entity.type;
    const materials = [];
    let bandMaterial = null;
    let sludgeMaterial = null;

    if (entity.type === "box") {
      const material = addRoughTextureShader(
        new THREE.MeshStandardMaterial({ color: 0x8a582f, roughness: 0.82 }),
      );
      const mesh = new THREE.Mesh(geometries.box, material);
      mesh.position.y = SCENE_UNITS.levelHeight / 2;
      group.add(mesh);
      materials.push(material);
    } else if (entity.type === "barrel") {
      const material = addRoughTextureShader(
        new THREE.MeshStandardMaterial({ color: 0xc53f35, roughness: 0.68 }),
      );
      const mesh = new THREE.Mesh(geometries.barrel, material);
      mesh.position.y = SCENE_UNITS.levelHeight / 2;
      const bottom = new THREE.Mesh(geometries.barrelBottom, material);
      bottom.position.y = (SCENE_UNITS.levelHeight - BARREL_VISUAL_HEIGHT) / 2;
      const lip = new THREE.Mesh(geometries.barrelLip, material);
      lip.position.y = BARREL_LIP_CENTER_Y;

      sludgeMaterial = createBarrelSludgeMaterial();
      const sludge = new THREE.Mesh(geometries.barrelSludge, sludgeMaterial);
      sludge.position.y = BARREL_SLUDGE_SURFACE_Y;
      sludge.renderOrder = 1;

      group.add(mesh, bottom, lip, sludge);
      materials.push(material);
      materials.push(sludgeMaterial);

      bandMaterial = new THREE.MeshStandardMaterial({
        color: 0xffc247,
        emissive: 0x9b3100,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0,
      });
      const band = new THREE.Mesh(geometries.barrelBand, bandMaterial);
      band.position.y = SCENE_UNITS.levelHeight * 0.52;
      group.add(band);
      materials.push(bandMaterial);
    } else {
      const material = new THREE.MeshStandardMaterial({ color: 0x3279b7, roughness: 0.62 });
      const body = new THREE.Mesh(geometries.playerBody, material);
      body.position.y = 0.31;
      const head = new THREE.Mesh(geometries.playerHead, material);
      head.position.y = 0.73;
      group.add(body, head);
      materials.push(material);
    }

    entityRoot.add(group);
    const record = {
      entity,
      group,
      materials,
      bandMaterial,
      sludgeMaterial,
      hasPlayerModel: false,
      opacity: 1,
    };
    entityRecords.set(entity.id, record);
    installPlayerModel(record);
    return record;
  }

  function setEntityVisual(record, opacity, armedStrength) {
    record.opacity = opacity;
    for (const material of record.materials) {
      if (material === record.bandMaterial) continue;
      setMaterialOpacity(material, opacity);
    }
    if (record.bandMaterial) {
      setMaterialOpacity(record.bandMaterial, opacity * armedStrength);
      record.bandMaterial.emissiveIntensity = 0.5 + armedStrength * 1.2;
    }
  }

  function setEntityTransform(record, entity) {
    const transform = entityTransform(entity, world);
    record.group.position.set(transform.x, transform.y, transform.z);
    record.entity = entity;
  }

  function setFixtureState(state, mix = 1, previousState = state) {
    const activeBefore = stateSet(previousState.activeSwitchColors);
    const activeAfter = stateSet(state.activeSwitchColors);
    const openBefore = stateSet(previousState.openDoorCoordinates, coordinateKey);
    const openAfter = stateSet(state.openDoorCoordinates, coordinateKey);

    for (const record of fixtureRecords) {
      if (record.type === "door") {
        const wasOpen = openBefore.has(record.key) ? 1 : 0;
        const isOpen = openAfter.has(record.key) ? 1 : 0;
        const openness = THREE.MathUtils.lerp(wasOpen, isOpen, mix);
        record.group.position.y = record.floorY
          + SCENE_UNITS.doorHeight / 2
          - openness * (SCENE_UNITS.doorHeight + 0.08);
        record.material.opacity = THREE.MathUtils.lerp(0.82, 0.3, openness);
      } else if (record.type === "switch") {
        const wasActive = activeBefore.has(record.color) ? 1 : 0;
        const isActive = activeAfter.has(record.color) ? 1 : 0;
        const active = THREE.MathUtils.lerp(wasActive, isActive, mix);
        record.group.position.y = record.floorY + THREE.MathUtils.lerp(0.065, 0.035, active);
        record.material.color.copy(record.inactiveColor).lerp(record.activeColor, active);
        record.material.emissive.copy(record.activeColor);
        record.material.emissiveIntensity = active * 0.42;
      }
    }
  }

  function ensureVerticalBounds(state) {
    let nextMin = minWorldY;
    let nextMax = maxWorldY;
    for (const entity of state.entities ?? []) {
      const transform = entityTransform(entity, world);
      nextMin = Math.min(nextMin, transform.y);
      nextMax = Math.max(nextMax, transform.y + transform.height);
    }
    const changed = nextMin !== minWorldY || nextMax !== maxWorldY;
    minWorldY = nextMin;
    maxWorldY = nextMax;
    if (changed) fitCamera();
  }

  function show(state) {
    if (!world || disposed) return;
    currentState = state;
    ensureVerticalBounds(state);
    const nextIds = new Set(state.entities.map((entity) => entity.id));
    for (const [id, record] of entityRecords) {
      if (!nextIds.has(id)) {
        entityRoot.remove(record.group);
        disposeRecord(record);
        entityRecords.delete(id);
      }
    }

    const armed = stateSet(state.armedBarrelIds);
    for (const entity of state.entities) {
      const record = entityRecords.get(entity.id) ?? createEntityRecord(entity);
      setEntityTransform(record, entity);
      record.group.scale.setScalar(1);
      setEntityVisual(record, 1, armed.has(entity.id) ? 1 : 0);
    }
    setFixtureState(state);
    container.setAttribute("aria-label", describeDynamicState(state, world));
    render();
  }

  function createBlastEffects(events) {
    const effects = [];
    for (const event of events ?? []) {
      if (event.type !== "barrelExploded") continue;
      const material = new THREE.MeshBasicMaterial({
        color: 0xff8a25,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometries.blast, material);
      const horizontal = coordinateToWorld(event.coordinate, world);
      mesh.position.set(
        horizontal.x,
        entityBottomY(event.bottomHalfSteps) + SCENE_UNITS.levelHeight / 2,
        horizontal.z,
      );
      mesh.scale.setScalar(0.1);
      effectRoot.add(mesh);
      effects.push({ mesh, material });
    }
    return effects;
  }

  function createFireEffects(events) {
    for (const event of events ?? []) {
      if (event.type !== "barrelExploded") continue;
      const material = createExplosionFireMaterial();
      const mesh = new THREE.Mesh(geometries.explosionFire, material);
      const horizontal = coordinateToWorld(event.coordinate, world);
      mesh.position.set(
        horizontal.x,
        entityBottomY(event.bottomHalfSteps) + SCENE_UNITS.levelHeight / 2,
        horizontal.z,
      );
      mesh.scale.setScalar(0.18);
      effectRoot.add(mesh);
      activeFireEffects.add({ mesh, material, startTime: performance.now() });
    }
  }

  async function animateTo(nextState, events = [], durationMs = TICK_DURATION_MS) {
    if (!currentState || durationMs <= 0 || disposed) {
      show(nextState);
      return;
    }
    ensureVerticalBounds(nextState);
    const generation = ++animationGeneration;
    const beforeState = currentState;
    const before = new Map(beforeState.entities.map((entity) => [entity.id, entity]));
    const after = new Map(nextState.entities.map((entity) => [entity.id, entity]));
    const ids = new Set([...before.keys(), ...after.keys()]);
    const armedBefore = stateSet(beforeState.armedBarrelIds);
    const armedAfter = stateSet(nextState.armedBarrelIds);

    for (const [id, entity] of after) {
      if (!entityRecords.has(id)) {
        const record = createEntityRecord(entity);
        setEntityTransform(record, entity);
        record.group.scale.setScalar(0.08);
        setEntityVisual(record, 0, armedAfter.has(id) ? 1 : 0);
      }
    }
    for (const [id, toEntity] of after) {
      const fromEntity = before.get(id);
      const record = entityRecords.get(id);
      if (!fromEntity || toEntity.type !== "player" || !record) continue;
      const angle = playerFacingAngle(
        entityTransform(fromEntity, world),
        entityTransform(toEntity, world),
      );
      if (angle !== null) record.group.rotation.y = angle;
    }
    const effects = createBlastEffects(events);
    createFireEffects(events);
    render();

    await new Promise((resolve) => {
      let startTime;
      function frame(time) {
        if (disposed || generation !== animationGeneration) {
          resolve();
          return;
        }
        startTime ??= time;
        const progress = Math.min(1, (time - startTime) / durationMs);
        const eased = progress * progress * (3 - 2 * progress);

        for (const id of ids) {
          const fromEntity = before.get(id);
          const toEntity = after.get(id);
          const record = entityRecords.get(id);
          if (!record) continue;
          const fromTransform = entityTransform(fromEntity ?? toEntity, world);
          const toTransform = entityTransform(toEntity ?? fromEntity, world);
          record.group.position.set(
            THREE.MathUtils.lerp(fromTransform.x, toTransform.x, eased),
            THREE.MathUtils.lerp(fromTransform.y, toTransform.y, eased),
            THREE.MathUtils.lerp(fromTransform.z, toTransform.z, eased),
          );
          const appearing = !fromEntity;
          const disappearing = !toEntity;
          const presence = appearing ? eased : disappearing ? 1 - eased : 1;
          record.group.scale.setScalar(THREE.MathUtils.lerp(0.08, 1, presence));
          const armedStart = armedBefore.has(id) ? 1 : 0;
          const armedEnd = armedAfter.has(id) ? 1 : 0;
          setEntityVisual(record, presence, THREE.MathUtils.lerp(armedStart, armedEnd, eased));
        }

        setFixtureState(nextState, eased, beforeState);
        for (const effect of effects) {
          effect.mesh.scale.setScalar(THREE.MathUtils.lerp(0.1, 1.65, eased));
          effect.material.opacity = 0.72 * (1 - eased);
        }
        render();
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });

    for (const effect of effects) {
      effectRoot.remove(effect.mesh);
      effect.material.dispose();
    }
    if (!disposed && generation === animationGeneration) show(nextState);
  }

  function setWorld(fullState) {
    animationGeneration += 1;
    clearFireEffects();
    world = fullState;
    currentState = null;
    terrainRoot.clear();
    ledgeGeometry?.dispose();
    ledgeGeometry = null;
    clearFixtures();
    clearEntities();

    const baselineElevation = terrainBaselineElevation(fullState.cells);
    const baselineY = baselineElevation * SCENE_UNITS.levelHeight;
    const waterWidth = fullState.width * SCENE_UNITS.grid + WATER_MARGIN * 2;
    const waterDepth = fullState.height * SCENE_UNITS.grid + WATER_MARGIN * 2;
    const waterY = baselineY - WATER_DEPTH_OFFSET;
    water.position.set(0, waterY, 0);
    water.scale.set(waterWidth, waterDepth, 1);
    waterMaterial.uniforms.uSize.value.set(waterWidth, waterDepth);
    water.visible = true;
    let terrainMin = baselineY;
    let terrainMax = -Infinity;
    const lowestSurfaceElevation = Math.min(
      ...fullState.cells.map(terrainSurfaceElevation),
    );
    const terrainBlocks = [];
    for (const cell of fullState.cells) {
      const surfaceElevation = cell.type === "ramp" ? cell.lowElevation : cell.elevation;
      const shadeElevation = terrainSurfaceElevation(cell);
      const position = coordinateToWorld(cell.coordinate, fullState);
      for (const segment of terrainColumnSegments(surfaceElevation, baselineElevation)) {
        terrainBlocks.push({ position, shadeElevation, ...segment });
      }
      terrainMax = Math.max(
        terrainMax,
        (cell.type === "ramp" ? cell.lowElevation + 1 : cell.elevation)
          * SCENE_UNITS.levelHeight,
      );
    }

    if (terrainBlocks.length) {
      const blocks = new THREE.InstancedMesh(
        geometries.terrainBlock,
        terrainMaterial,
        terrainBlocks.length,
      );
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      terrainBlocks.forEach((block, index) => {
        const height = block.top - block.bottom;
        position.set(block.position.x, block.bottom + height / 2, block.position.z);
        scale.set(1, height, 1);
        matrix.compose(position, rotation, scale);
        blocks.setMatrixAt(index, matrix);
        blocks.setColorAt(index, terrainShade(block.shadeElevation, lowestSurfaceElevation));
      });
      blocks.instanceMatrix.needsUpdate = true;
      blocks.instanceColor.needsUpdate = true;
      terrainRoot.add(blocks);
    }

    for (const direction of ["north", "east", "south", "west"]) {
      const cells = fullState.cells.filter(
        (cell) => cell.type === "ramp" && cell.lowDirection === direction,
      );
      if (!cells.length) continue;
      const ramps = new THREE.InstancedMesh(geometries[direction], terrainMaterial, cells.length);
      const matrix = new THREE.Matrix4();
      cells.forEach((cell, index) => {
        const position = coordinateToWorld(cell.coordinate, fullState);
        const lowY = cell.lowElevation * SCENE_UNITS.levelHeight;
        matrix.makeTranslation(position.x, lowY, position.z);
        ramps.setMatrixAt(index, matrix);
        ramps.setColorAt(index, terrainShade(terrainSurfaceElevation(cell), lowestSurfaceElevation));
      });
      ramps.instanceMatrix.needsUpdate = true;
      ramps.instanceColor.needsUpdate = true;
      terrainRoot.add(ramps);
    }

    ledgeGeometry = createLedgeGeometry(fullState.cells, fullState);
    if (ledgeGeometry) terrainRoot.add(new LineSegments2(ledgeGeometry, ledgeMaterial));

    const cells = new Map(fullState.cells.map((cell) => [coordinateKey(cell.coordinate), cell]));
    for (const fixture of fullState.fixtures) {
      const key = coordinateKey(fixture.coordinate);
      const cell = cells.get(key);
      const floorY = cellSurfaceRange(cell).high;
      const horizontal = coordinateToWorld(fixture.coordinate, fullState);
      const group = new THREE.Group();
      group.position.set(horizontal.x, floorY, horizontal.z);
      fixtureRoot.add(group);

      if (fixture.type === "door") {
        const material = new THREE.MeshStandardMaterial({
          color: FIXTURE_COLORS[fixture.color],
          roughness: 0.54,
          transparent: true,
          opacity: 0.82,
        });
        group.add(new THREE.Mesh(geometries.door, material));
        fixtureRecords.push({ type: "door", key, floorY, group, material, materials: [material] });
      } else if (fixture.type === "switch") {
        const inactiveColor = new THREE.Color(FIXTURE_COLORS[fixture.color]).multiplyScalar(0.62);
        const activeColor = new THREE.Color(FIXTURE_COLORS[fixture.color]).lerp(new THREE.Color(0xffffff), 0.25);
        const material = new THREE.MeshStandardMaterial({
          color: inactiveColor,
          emissive: activeColor,
          emissiveIntensity: 0,
          roughness: 0.55,
        });
        group.add(new THREE.Mesh(geometries.switch, material));
        fixtureRecords.push({
          type: "switch",
          color: fixture.color,
          floorY,
          group,
          material,
          materials: [material],
          inactiveColor,
          activeColor,
        });
      } else {
        const ringMaterial = new THREE.MeshStandardMaterial({
          color: 0x45a889,
          emissive: 0x176750,
          emissiveIntensity: 0.45,
          roughness: 0.4,
        });
        const labelMaterial = new THREE.MeshStandardMaterial({
          color: EXIT_LABEL_COLOR,
          emissive: 0x3d1c75,
          emissiveIntensity: 0.55,
          roughness: 0.38,
        });
        const mesh = new THREE.Mesh(geometries.exit, ringMaterial);
        mesh.position.y = 0.07;
        const label = createExitLabel(geometries.exitLabelStroke, labelMaterial);
        group.add(mesh, label);
        fixtureRecords.push({
          type: "exit",
          floorY,
          group,
          label,
          materials: [ringMaterial, labelMaterial],
        });
        terrainMax = Math.max(
          terrainMax,
          floorY + EXIT_LABEL_BASE_Y + EXIT_LABEL_HEIGHT / 2 + EXIT_LABEL_FLOAT_AMPLITUDE,
        );
      }
    }

    minWorldY = Math.min(Number.isFinite(terrainMin) ? terrainMin : 0, waterY - WATER_WAVE_HEIGHT);
    maxWorldY = Number.isFinite(terrainMax) ? terrainMax : SCENE_UNITS.levelHeight;
    fitCamera();
  }

  function handleResize() {
    fitCamera();
  }
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", handleResize);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    animationGeneration += 1;
    if (waterAnimationFrame) cancelAnimationFrame(waterAnimationFrame);
    reducedMotion?.removeEventListener?.("change", syncWaterAnimation);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", handleResize);
    clearFixtures();
    clearEntities();
    clearFireEffects();
    disposePlayerModelTemplate(playerModelTemplate);
    playerModelTemplate = null;
    for (const effect of [...effectRoot.children]) {
      effect.material?.dispose();
      effectRoot.remove(effect);
    }
    waterGeometry.dispose();
    waterMaterial.dispose();
    ledgeGeometry?.dispose();
    ledgeMaterial.dispose();
    terrainMaterial.dispose();
    for (const geometry of Object.values(geometries)) geometry.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return Object.freeze({ setWorld, show, animateTo, dispose });
}
