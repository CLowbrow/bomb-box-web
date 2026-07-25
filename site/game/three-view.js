import * as THREE from "three";
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
const CAMERA_FOV = 34;
const WATER_MARGIN = 2.4;
const WATER_FRUSTUM_OVERSCAN = 0.8;
const WATER_DEPTH_OFFSET = 0.36;
const WATER_WAVE_HEIGHT = 0.055;
const FIXTURE_COLORS = Object.freeze({
  red: 0xc84b3f,
  green: 0x4f9b62,
  blue: 0x477fc2,
  yellow: 0xd6a928,
});

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

function setMaterialOpacity(material, opacity) {
  material.opacity = opacity;
  material.transparent = opacity < 1;
  material.depthWrite = opacity > 0.98;
}

function stateSet(values, key = (value) => value) {
  return new Set((values ?? []).map(key));
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

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 10000);
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
  const geometries = {
    terrainBlock: new THREE.BoxGeometry(SCENE_UNITS.floorSize, 1, SCENE_UNITS.floorSize),
    north: createRampGeometry("north"),
    east: createRampGeometry("east"),
    south: createRampGeometry("south"),
    west: createRampGeometry("west"),
    box: new THREE.BoxGeometry(SCENE_UNITS.boxSize, SCENE_UNITS.levelHeight, SCENE_UNITS.boxSize),
    barrel: new THREE.CylinderGeometry(
      SCENE_UNITS.barrelDiameter / 2,
      SCENE_UNITS.barrelDiameter / 2,
      SCENE_UNITS.levelHeight,
      20,
    ),
    barrelBand: new THREE.TorusGeometry(SCENE_UNITS.barrelDiameter / 2 + 0.012, 0.035, 6, 24),
    playerBody: new THREE.ConeGeometry(0.31, 0.62, 16),
    playerHead: new THREE.SphereGeometry(0.17, 16, 10),
    switch: new THREE.CylinderGeometry(0.27, 0.27, 0.08, 24),
    door: new THREE.BoxGeometry(0.7, SCENE_UNITS.doorHeight, 0.7),
    exit: new THREE.TorusGeometry(0.31, 0.055, 8, 28),
    blast: new THREE.SphereGeometry(0.34, 14, 10),
  };
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

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  function render() {
    if (!disposed) renderer.render(scene, camera);
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
    waterMaterial.uniforms.uTime.value = time * 0.001;
    render();
    waterAnimationFrame = requestAnimationFrame(animateWater);
  }

  function syncWaterAnimation() {
    if (reducedMotion?.matches) {
      if (waterAnimationFrame) cancelAnimationFrame(waterAnimationFrame);
      waterAnimationFrame = 0;
      waterMaterial.uniforms.uTime.value = 0;
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
    const distance = halfFrame / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2))
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

  function createEntityRecord(entity) {
    const group = new THREE.Group();
    group.userData.entityId = entity.id;
    group.userData.entityType = entity.type;
    const materials = [];
    let bandMaterial = null;

    if (entity.type === "box") {
      const material = new THREE.MeshStandardMaterial({ color: 0x8a582f, roughness: 0.82 });
      const mesh = new THREE.Mesh(geometries.box, material);
      mesh.position.y = SCENE_UNITS.levelHeight / 2;
      group.add(mesh);
      materials.push(material);
    } else if (entity.type === "barrel") {
      const material = new THREE.MeshStandardMaterial({ color: 0xc53f35, roughness: 0.68 });
      const mesh = new THREE.Mesh(geometries.barrel, material);
      mesh.position.y = SCENE_UNITS.levelHeight / 2;
      group.add(mesh);
      materials.push(material);

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
    const record = { entity, group, materials, bandMaterial };
    entityRecords.set(entity.id, record);
    return record;
  }

  function setEntityVisual(record, opacity, armedStrength) {
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

  async function animateTo(nextState, events = [], durationMs = 500) {
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
    const effects = createBlastEffects(events);

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
    world = fullState;
    currentState = null;
    terrainRoot.clear();
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
    const terrainBlocks = [];
    for (const cell of fullState.cells) {
      const surfaceElevation = cell.type === "ramp" ? cell.lowElevation : cell.elevation;
      const position = coordinateToWorld(cell.coordinate, fullState);
      for (const segment of terrainColumnSegments(surfaceElevation, baselineElevation)) {
        terrainBlocks.push({ position, ...segment });
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
      });
      blocks.instanceMatrix.needsUpdate = true;
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
      });
      ramps.instanceMatrix.needsUpdate = true;
      terrainRoot.add(ramps);
    }

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
        const material = new THREE.MeshStandardMaterial({
          color: 0x45a889,
          emissive: 0x176750,
          emissiveIntensity: 0.45,
          roughness: 0.4,
        });
        const mesh = new THREE.Mesh(geometries.exit, material);
        mesh.position.y = 0.07;
        group.add(mesh);
        fixtureRecords.push({ type: "exit", floorY, group, materials: [material] });
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
    for (const effect of [...effectRoot.children]) {
      effect.material?.dispose();
      effectRoot.remove(effect);
    }
    waterGeometry.dispose();
    waterMaterial.dispose();
    terrainMaterial.dispose();
    for (const geometry of Object.values(geometries)) geometry.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return Object.freeze({ setWorld, show, animateTo, dispose });
}
