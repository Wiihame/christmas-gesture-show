import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { InteractiveSnow } from './interactive-snow.js';

const tiers = [
  { bottom: 0.7, height: 2.0, radius: 2.02 },
  { bottom: 1.7, height: 1.9, radius: 1.65 },
  { bottom: 2.65, height: 1.65, radius: 1.29 },
  { bottom: 3.48, height: 1.45, radius: 0.98 },
  { bottom: 4.2, height: 1.22, radius: 0.71 },
  { bottom: 4.85, height: 1.14, radius: 0.46 },
];

function canopyRadius(height: number): number {
  return Math.max(0.05, ...tiers.map((tier) => {
    const fraction = (height - tier.bottom) / tier.height;
    return fraction >= 0 && fraction <= 1 ? tier.radius * (1 - fraction) : 0;
  }));
}

function canopyOwner(height: number): number {
  let owner = 0;
  let radius = 0;
  tiers.forEach((tier, index) => {
    const fraction = (height - tier.bottom) / tier.height;
    const candidate = fraction >= 0 && fraction <= 1 ? tier.radius * (1 - fraction) : 0;
    if (candidate > radius) {
      radius = candidate;
      owner = index;
    }
  });
  return owner;
}

function normalizedProgress(value: number): number {
  return Number.isNaN(value) ? 0 : THREE.MathUtils.clamp(value, 0, 1);
}

const decorationBands = [0.88, ...tiers.slice(1).map((tier) => tier.bottom), 5.72];

function decorationHeight(progress: number): number {
  if (progress >= 1) return decorationBands[tiers.length];
  const scaled = progress * tiers.length;
  const index = Math.floor(scaled);
  return THREE.MathUtils.lerp(decorationBands[index], decorationBands[index + 1], scaled - index);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法绘制灯光纹理。');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,.9)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class ChristmasScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 65);
  private readonly tree = new THREE.Group();
  private readonly lightString = new THREE.Group();
  private readonly presents = new THREE.Group();
  private readonly treeBase = new THREE.Group();
  private readonly canopyLayers: THREE.Group[] = [];
  private readonly decorationLayers = tiers.map(() => new THREE.Group());
  private readonly growthPlanes = tiers.map(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6));
  private readonly decorationPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  private readonly growthCutoffs = new Float32Array(tiers.length).fill(1e6);
  private readonly presentBoxes: THREE.Group[] = [];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly notice: HTMLParagraphElement;
  private readonly textures = new Set<THREE.Texture>();
  private readonly random = seededRandom(20261121);
  private snow!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private bulbGlow!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private celebration!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly handSnowPool = new InteractiveSnow(576, this.random);
  private handSnow!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private starGlow!: THREE.Sprite;
  private starLight!: THREE.PointLight;
  private star!: THREE.Group;
  private frame: number | null = null;
  private lastTime = 0;
  private elapsed = 0;
  private reveal = 0;
  private replayCount = 0;
  private growthCount = 0;
  private decorationCount = 0;
  private celebrationCount = 0;
  private growthPending = false;
  private continuous = false;
  private growthProgress = 1;
  private decorationProgress = 1;
  private growthCompleted = false;
  private decorationCompleted = false;
  private celebrationStart: number | null = null;
  private disposed = false;
  private contextLost = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.setAttribute('aria-label', '可拖动旋转的三维圣诞树，包含彩灯、星星、礼盒和雪花');
    this.renderer.domElement.dataset.scene = 'christmas-tree';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'pan-y';
    container.append(this.renderer.domElement);

    this.notice = document.createElement('p');
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.notice.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;padding:24px;background:#0a140de0;color:#d9e5d5;text-align:center;font-size:13px;z-index:2;';
    container.append(this.notice);

    this.camera.position.set(8.3, 5.1, 11.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 3, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = Math.PI * 0.26;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 24;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);

    try {
      this.scene.background = new THREE.Color('#08130e');
      this.scene.fog = new THREE.FogExp2('#08130e', 0.028);
      this.buildLighting();
      this.buildGround();
      this.buildTree();
      this.buildLightString();
      this.buildStar();
      this.buildPresents();
      this.buildSnow();
      this.buildCelebration();
      this.buildHandSnow();
      this.resize();
      this.container.dataset.sceneStatus = 'ready';
      this.container.dataset.growthCount = '0';
      this.container.dataset.decorationCount = '0';
      this.container.dataset.celebrationCount = '0';
      this.container.dataset.interactionStage = 'preview';
      this.replay();
      this.start();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  replay(): void {
    if (this.disposed) return;
    this.clearHandSnow();
    this.restoreFullGeometry();
    this.growthCompleted = false;
    this.decorationCompleted = false;
    if (this.container.dataset.interactionStage !== 'preview') {
      this.setLights(true);
      this.setSnow(true);
    }
    this.tree.visible = true;
    this.treeBase.visible = true;
    this.presents.visible = true;
    this.cancelCelebration();
    this.container.dataset.interactionStage = 'preview';
    this.beginGrowth();
  }

  startInteraction(): void {
    if (this.disposed) return;
    this.clearHandSnow();
    this.continuous = true;
    this.growthPending = false;
    this.growthProgress = 0;
    this.decorationProgress = 0;
    this.growthCompleted = false;
    this.decorationCompleted = false;
    this.reveal = 1;
    this.tree.scale.setScalar(1);
    this.container.dataset.reveal = '1.000';
    this.applyContinuousProgress();
    this.setLights(false);
    this.setSnow(true);
    this.cancelCelebration();
    this.container.dataset.interactionStage = 'waiting';
    this.snow.material.uniforms.uIntensity.value = 0.25;
    this.container.dataset.snowIntensity = '0.25';
  }

  setGrowthProgress(progress: number): void {
    if (this.disposed) return;
    if (!this.continuous) this.startInteraction();
    this.growthProgress = normalizedProgress(progress);
    this.applyContinuousProgress();
    this.container.dataset.interactionStage = this.growthProgress === 0 ? 'waiting' : this.growthProgress < 1 ? 'growing' : 'ready';
    if (this.growthProgress >= 1 && !this.growthCompleted) {
      this.growthCompleted = true;
      this.container.dataset.growthCount = String(++this.growthCount);
      this.container.dispatchEvent(new Event('tree-growth-complete'));
    }
  }

  setDecorationProgress(progress: number): void {
    if (this.disposed) return;
    if (!this.continuous) this.startInteraction();
    this.decorationProgress = normalizedProgress(progress);
    this.applyContinuousProgress();
    this.container.dataset.interactionStage = this.decorationProgress >= 1 ? 'decorated' : 'decorating';
    if (this.decorationProgress >= 1 && !this.decorationCompleted) {
      this.decorationCompleted = true;
      this.container.dataset.decorationCount = String(++this.decorationCount);
      this.container.dispatchEvent(new Event('tree-decoration-complete'));
    }
  }

  growTree(): void {
    if (this.disposed) return;
    this.restoreFullGeometry();
    this.tree.visible = true;
    this.treeBase.visible = true;
    this.presents.visible = false;
    this.setLights(false);
    this.setSnow(true);
    this.cancelCelebration();
    this.container.dataset.growthCount = String(++this.growthCount);
    this.container.dataset.interactionStage = 'growing';
    this.beginGrowth();
  }

  decorate(): void {
    if (this.disposed) return;
    if (this.continuous) {
      this.setDecorationProgress(1);
      return;
    }
    this.tree.visible = true;
    this.treeBase.visible = true;
    this.presents.visible = true;
    this.setLights(true);
    if (!this.growthPending) {
      this.reveal = 1;
      this.tree.scale.setScalar(1);
      this.container.dataset.reveal = '1.000';
    }
    this.container.dataset.decorationCount = String(++this.decorationCount);
    this.container.dataset.interactionStage = 'decorated';
  }

  celebrate(): void {
    if (this.disposed) return;
    if (!this.continuous && (!this.presents.visible || !this.lightString.visible)) this.decorate();
    this.celebrationStart = this.elapsed;
    this.celebration.material.uniforms.uAge.value = 0;
    this.celebration.visible = true;
    this.container.dataset.celebrationCount = String(++this.celebrationCount);
    this.container.dataset.celebrationActive = 'true';
    this.container.dataset.celebrationAge = '0';
    if (!this.continuous) this.container.dataset.interactionStage = 'celebrating';
  }

  private beginGrowth(): void {
    this.reveal = 0;
    this.growthPending = true;
    this.container.dataset.reveal = '0';
    this.container.dataset.replayCount = String(++this.replayCount);
    this.tree.scale.set(0.6, 0.001, 0.6);
  }

  private applyContinuousProgress(): void {
    this.setLights(this.decorationProgress > 0 && this.growthProgress > 0);
    const cutoff = decorationHeight(this.decorationProgress);
    this.decorationPlane.constant = cutoff;
    let tierCount = 0;
    let decorationLayerCount = 0;
    tiers.forEach((tier, index) => {
      const local = THREE.MathUtils.clamp(this.growthProgress * tiers.length - index, 0, 1);
      this.canopyLayers[index].visible = local > 0;
      const height = local > 0 ? tier.bottom + tier.height * local : -1e6;
      this.growthPlanes[index].constant = height;
      this.growthCutoffs[index] = height;
      if (local > 0) ++tierCount;
      const decorated = local > 0 && this.decorationProgress > 0 && Math.min(height, cutoff) > decorationBands[index];
      this.decorationLayers[index].visible = decorated;
      if (decorated) ++decorationLayerCount;
    });
    this.tree.visible = this.growthProgress > 0;
    this.treeBase.visible = this.growthProgress > 0;
    this.star.visible = this.growthProgress >= 1;
    this.presents.visible = this.growthProgress > 0 && this.decorationProgress > 0;
    const visibleDecoration = Math.min(this.growthProgress, this.decorationProgress);
    this.presentBoxes.forEach((box, index) => {
      const local = THREE.MathUtils.clamp(visibleDecoration * this.presentBoxes.length - index, 0, 1);
      box.visible = local > 0;
      box.scale.setScalar(local);
    });
    this.bulbGlow.material.uniforms.uDecorationCutoff.value = cutoff;
    this.container.dataset.growthProgress = String(this.growthProgress);
    this.container.dataset.decorationProgress = String(this.decorationProgress);
    this.container.dataset.tierCount = String(tierCount);
    this.container.dataset.decorationLayerCount = String(decorationLayerCount);
  }

  private restoreFullGeometry(): void {
    this.continuous = false;
    this.growthProgress = 1;
    this.decorationProgress = 1;
    this.growthCutoffs.fill(1e6);
    this.growthPlanes.forEach((plane) => { plane.constant = 1e6; });
    this.decorationPlane.constant = 1e6;
    this.canopyLayers.forEach((layer) => { layer.visible = true; });
    this.decorationLayers.forEach((layer) => { layer.visible = true; });
    this.presentBoxes.forEach((box) => { box.visible = true; box.scale.setScalar(1); });
    this.star.visible = true;
    this.bulbGlow.material.uniforms.uDecorationCutoff.value = 1e6;
    this.container.dataset.growthProgress = '1';
    this.container.dataset.decorationProgress = '1';
    this.container.dataset.tierCount = String(tiers.length);
    this.container.dataset.decorationLayerCount = String(tiers.length);
  }

  private cancelCelebration(): void {
    this.celebrationStart = null;
    this.celebration.visible = false;
    this.celebration.material.uniforms.uAge.value = 0;
    this.container.dataset.celebrationActive = 'false';
    this.container.dataset.celebrationAge = '0';
  }

  private updateCelebration(): void {
    if (this.celebrationStart === null) return;
    const age = this.elapsed - this.celebrationStart;
    this.celebration.material.uniforms.uAge.value = age;
    this.container.dataset.celebrationAge = age.toFixed(3);
    if (age < 2.8) return;
    const notify = this.continuous || this.container.dataset.interactionStage === 'celebrating';
    this.cancelCelebration();
    this.container.dataset.celebrationAge = age.toFixed(3);
    if (!this.continuous && this.container.dataset.interactionStage === 'celebrating') {
      this.container.dataset.interactionStage = 'decorated';
    }
    if (notify) this.container.dispatchEvent(new Event('tree-celebration-complete'));
  }

  setLights(enabled: boolean): void {
    if (this.disposed) return;
    this.lightString.visible = enabled;
    this.starLight.intensity = enabled ? 9 : 0;
    this.starGlow.material.opacity = enabled ? 0.7 : 0.22;
    this.container.dataset.lights = String(enabled);
  }

  setSnow(enabled: boolean): void {
    if (this.disposed) return;
    this.snow.visible = enabled;
    this.snow.material.uniforms.uIntensity.value = enabled ? 1 : 0;
    this.container.dataset.snow = String(enabled);
    this.container.dataset.snowIntensity = enabled ? '1' : '0';
  }

  setAutoRotate(enabled: boolean): void {
    if (this.disposed) return;
    this.controls.autoRotate = enabled;
    this.container.dataset.autoRotate = String(enabled);
  }

  setHandSnowEmitter(screenX: number | null): void {
    if (this.disposed) return;
    this.handSnowPool.setEmitter(document.hidden || this.contextLost ? null : screenX, performance.now());
    this.syncHandSnow();
  }

  private clearHandSnow(): void {
    this.handSnowPool.clear();
    this.syncHandSnow();
  }

  private syncHandSnow(): void {
    if (!this.handSnow) return;
    this.handSnow.geometry.getAttribute('position').needsUpdate = true;
    this.handSnow.geometry.getAttribute('aOpacity').needsUpdate = true;
    this.handSnow.geometry.getAttribute('aSize').needsUpdate = true;
    this.handSnow.visible = this.handSnowPool.particleCount > 0;
    this.container.dataset.handSnowActive = String(this.handSnowPool.active);
    this.container.dataset.handSnowEmitterX = String(this.handSnowPool.emitterX);
    this.container.dataset.handSnowParticleCount = String(this.handSnowPool.particleCount);
    this.container.dataset.handSnowSpawnedCount = String(this.handSnowPool.spawnedCount);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
        else materials.add(object.material);
      } else if (object instanceof THREE.Sprite) {
        geometries.add(object.geometry);
        materials.add(object.material);
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Light && 'shadow' in object) {
        (object as THREE.DirectionalLight | THREE.PointLight).shadow.dispose();
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.notice.remove();
    this.scene.clear();
    this.container.dataset.sceneStatus = 'disposed';
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight('#e4f0de', '#1c3023', 2));
    const key = new THREE.DirectionalLight('#fff0d0', 3);
    key.position.set(4, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -5;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#83bdb1', 1.7);
    rim.position.set(-4, 5, -5);
    this.scene.add(rim);
    const warmth = new THREE.PointLight('#ffb966', 24, 13, 2);
    warmth.position.set(3, 3.5, 4);
    this.scene.add(warmth);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#10251a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.13;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.treeBase.name = 'tree-base';
    this.scene.add(this.treeBase);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.35, 3.4, 0.12, 80), new THREE.MeshStandardMaterial({ color: '#473922', roughness: 0.8 }));
    platform.position.y = -0.04;
    platform.receiveShadow = true;
    this.treeBase.add(platform);
    const snow = new THREE.Mesh(new THREE.SphereGeometry(3.3, 64, 24), new THREE.MeshStandardMaterial({ color: '#e5e9de', roughness: 0.95 }));
    snow.scale.y = 0.045;
    snow.position.y = 0.01;
    snow.receiveShadow = true;
    snow.name = 'snow-base';
    this.treeBase.add(snow);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.37, 0.017, 8, 96), new THREE.MeshStandardMaterial({ color: '#b38d42', metalness: 0.75, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    this.treeBase.add(rim);
  }

  private buildTree(): void {
    this.tree.name = 'christmas-tree';
    this.scene.add(this.tree);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 1.35, 12), new THREE.MeshStandardMaterial({
      color: '#503525', roughness: 1, clippingPlanes: [this.growthPlanes[0]], clipShadows: true,
    }));
    trunk.position.y = 0.66;
    trunk.castShadow = true;
    this.tree.add(trunk);
    const needleGeometry = new THREE.ConeGeometry(0.015, 0.24, 3);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const point = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    tiers.forEach((tier, index) => {
      const layer = new THREE.Group();
      layer.name = 'canopy-layer';
      layer.userData.tierIndex = index;
      this.canopyLayers.push(layer);
      this.tree.add(layer);
      const plane = this.growthPlanes[index];
      const foliage = new THREE.MeshStandardMaterial({
        color: '#1d5130', roughness: 0.96, flatShading: true, clippingPlanes: [plane], clipShadows: true,
      });
      const geometry = new THREE.ConeGeometry(tier.radius, tier.height, 56, 5);
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const angle = Math.atan2(z, x);
        const wave = 1 + 0.04 * Math.sin(angle * 19 + index) + 0.025 * Math.cos(angle * 31);
        positions.setXYZ(i, x * wave, positions.getY(i), z * wave);
      }
      geometry.computeVertexNormals();
      const canopy = new THREE.Mesh(geometry, foliage);
      canopy.position.y = tier.bottom + tier.height / 2;
      canopy.rotation.y = index * 0.23;
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      canopy.name = 'canopy-tier';
      layer.add(canopy);
      const needleCount = 2000;
      const needles = new THREE.InstancedMesh(needleGeometry, new THREE.MeshStandardMaterial({
        color: '#ffffff', roughness: 1, clippingPlanes: [plane], clipShadows: true,
      }), needleCount);
      needles.name = 'pine-needles';
      for (let i = 0; i < needleCount; i++) {
        const fraction = Math.pow(this.random(), 1.7);
        const height = tier.bottom + fraction * tier.height;
        const angle = this.random() * Math.PI * 2;
        const radius = tier.radius * (1 - fraction) * (0.97 + this.random() * 0.055);
        point.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        direction.set(Math.cos(angle), 0.08 + this.random() * 0.32, Math.sin(angle)).normalize();
        quaternion.setFromUnitVectors(up, direction);
        const size = 0.65 + this.random() * 0.8;
        scale.set(size, size, size);
        matrix.compose(point, quaternion, scale);
        needles.setMatrixAt(i, matrix);
        color.setHSL(0.31 + this.random() * 0.025, 0.4 + this.random() * 0.2, 0.13 + this.random() * 0.13);
        needles.setColorAt(i, color);
      }
      needles.instanceMatrix.needsUpdate = true;
      if (needles.instanceColor) needles.instanceColor.needsUpdate = true;
      needles.receiveShadow = true;
      needles.computeBoundingSphere();
      layer.add(needles);
    });
  }

  private buildLightString(): void {
    this.lightString.name = 'spiral-lights';
    this.tree.add(this.lightString);
    this.decorationLayers.forEach((layer, index) => {
      layer.name = 'decoration-layer';
      layer.userData.tierIndex = index;
      this.lightString.add(layer);
    });
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 360; i++) {
      const fraction = i / 360;
      const height = 0.88 + fraction * 4.84;
      const angle = fraction * Math.PI * 2 * 5.2;
      const radius = canopyRadius(height) + 0.1;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius));
    }
    const path = new THREE.CatmullRomCurve3(points);
    const runs: Array<{ owner: number; points: THREE.Vector3[] }> = [];
    for (let i = 1; i < points.length; i++) {
      const owner = Math.max(canopyOwner(points[i - 1].y), canopyOwner(points[i].y));
      const last = runs.at(-1);
      if (last?.owner === owner) last.points.push(points[i]);
      else runs.push({ owner, points: [points[i - 1], points[i]] });
    }
    runs.forEach((run) => {
      const curve = new THREE.CatmullRomCurve3(run.points);
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, run.points.length * 2), 0.011, 5, false), new THREE.MeshStandardMaterial({
        color: '#726238', metalness: 0.5, roughness: 0.45,
        clippingPlanes: [this.growthPlanes[run.owner], this.decorationPlane],
      }));
      this.decorationLayers[run.owner].add(cable);
    });
    const colors = ['#ffd18b', '#ef7283', '#9fd8f0', '#c19bed', '#b6e1a2'];
    const count = 146;
    const glowPositions = new Float32Array(count * 3);
    const glowColors = new Float32Array(count * 3);
    const glowTiers = new Float32Array(count);
    const layerBulbs: Array<Array<{ point: THREE.Vector3; color: THREE.Color }>> = tiers.map(() => []);
    for (let i = 0; i < count; i++) {
      const point = path.getPointAt(i / (count - 1));
      const color = new THREE.Color(colors[i % colors.length]);
      const owner = canopyOwner(point.y);
      point.toArray(glowPositions, i * 3);
      color.toArray(glowColors, i * 3);
      glowTiers[i] = owner;
      layerBulbs[owner].push({ point, color });
    }
    const sphere = new THREE.SphereGeometry(0.047, 8, 6);
    const matrix = new THREE.Matrix4();
    layerBulbs.forEach((items, index) => {
      const bulbs = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({
        color: '#ffffff', toneMapped: false, clippingPlanes: [this.growthPlanes[index], this.decorationPlane],
      }), items.length);
      bulbs.name = 'colored-bulbs';
      items.forEach(({ point, color }, i) => {
        matrix.makeTranslation(point.x, point.y, point.z);
        bulbs.setMatrixAt(i, matrix);
        bulbs.setColorAt(i, color);
      });
      bulbs.instanceMatrix.needsUpdate = true;
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
      bulbs.computeBoundingSphere();
      this.decorationLayers[index].add(bulbs);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
    geometry.setAttribute('aTier', new THREE.BufferAttribute(glowTiers, 1));
    this.bulbGlow = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() },
        uGrowthCutoffs: { value: this.growthCutoffs }, uDecorationCutoff: { value: 1e6 },
      },
      vertexShader: `
        attribute vec3 color;
        attribute float aTier;
        varying vec3 vColor;
        varying float vTier;
        varying float vHeight;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vTier = aTier;
          vHeight = (modelMatrix * vec4(position, 1.0)).y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(190.0 / -mv.z, 5.0, 26.0) * uPixelRatio;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTier;
        varying float vHeight;
        uniform float uTime;
        uniform float uGrowthCutoffs[6];
        uniform float uDecorationCutoff;
        void main() {
          if (vHeight > uGrowthCutoffs[int(vTier + .5)] || vHeight > uDecorationCutoff) discard;
          float d = length(gl_PointCoord - .5) * 2.0;
          float glow = pow(max(0.0, 1.0 - d), 3.0);
          float flicker = .82 + .18 * sin(uTime * 1.7 + vColor.r * 6.0);
          gl_FragColor = vec4(vColor * 1.3, glow * .72 * flicker);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    this.bulbGlow.frustumCulled = false;
    this.lightString.add(this.bulbGlow);
    this.container.dataset.lights = 'true';
  }

  private buildStar(): void {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI / 2 + i * Math.PI / 5;
      const radius = i % 2 === 0 ? 0.46 : 0.21;
      if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.025, bevelSegments: 2, steps: 1 });
    geometry.translate(0, 0, -0.05);
    const star = new THREE.Group();
    this.star = star;
    star.name = 'tree-top-star';
    star.position.y = 6.26;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#efd184', metalness: 0.62, roughness: 0.3, emissive: '#ffb737', emissiveIntensity: 0.45 }));
    mesh.rotation.y = 0.55;
    star.add(mesh);
    const texture = glowTexture();
    this.textures.add(texture);
    this.starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: '#ffc46c', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7, toneMapped: false }));
    this.starGlow.scale.set(1.65, 1.65, 1);
    star.add(this.starGlow);
    this.starLight = new THREE.PointLight('#ffc879', 9, 5, 2);
    this.starLight.position.set(0, 0, 0.3);
    star.add(this.starLight);
    this.tree.add(star);
  }

  private buildPresents(): void {
    this.presents.name = 'presents';
    this.scene.add(this.presents);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const ribbonGold = new THREE.MeshStandardMaterial({ color: '#d9b775', metalness: 0.62, roughness: 0.4 });
    const ribbonSilver = new THREE.MeshStandardMaterial({ color: '#d6dfdf', metalness: 0.55, roughness: 0.45 });
    const specs = [
      { x: -1.65, z: 2.0, w: 0.92, h: 0.78, d: 0.8, color: '#8b3343', silver: false },
      { x: 0.72, z: 2.42, w: 0.75, h: 1.04, d: 0.75, color: '#304d65', silver: true },
      { x: 2.18, z: 1.24, w: 0.85, h: 0.67, d: 0.76, color: '#47705a', silver: false },
      { x: -2.2, z: 0.35, w: 0.64, h: 0.65, d: 0.62, color: '#d6bd95', silver: false },
      { x: -0.55, z: 2.92, w: 0.58, h: 0.43, d: 0.55, color: '#9d5d3c', silver: false },
    ];
    specs.forEach((spec, index) => {
      const group = new THREE.Group();
      group.name = 'gift-box';
      group.position.set(spec.x, 0.13, spec.z);
      group.rotation.y = (index - 2) * 0.16;
      const material = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.65, metalness: 0.05 });
      const ribbon = spec.silver ? ribbonSilver : ribbonGold;
      const box = new THREE.Mesh(boxGeometry, material);
      box.scale.set(spec.w, spec.h, spec.d);
      box.position.y = spec.h / 2;
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
      const lid = new THREE.Mesh(boxGeometry, material);
      lid.scale.set(spec.w + 0.05, 0.11, spec.d + 0.05);
      lid.position.y = spec.h;
      lid.castShadow = true;
      group.add(lid);
      const strapX = new THREE.Mesh(boxGeometry, ribbon);
      strapX.scale.set(spec.w * 0.13, spec.h + 0.12, spec.d + 0.063);
      strapX.position.y = (spec.h + 0.03) / 2;
      const strapZ = new THREE.Mesh(boxGeometry, ribbon);
      strapZ.scale.set(spec.w + 0.063, spec.h + 0.12, spec.d * 0.13);
      strapZ.position.y = (spec.h + 0.03) / 2;
      group.add(strapX, strapZ);
      for (const sign of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, spec.h + 0.08, 0),
          new THREE.Vector3(sign * 0.15, spec.h + 0.3, -0.045),
          new THREE.Vector3(sign * 0.3, spec.h + 0.22, 0),
          new THREE.Vector3(sign * 0.15, spec.h + 0.1, 0.065),
          new THREE.Vector3(0, spec.h + 0.08, 0),
        ]);
        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.027, 5, false), ribbon));
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), ribbon);
      knot.position.y = spec.h + 0.11;
      group.add(knot);
      this.presents.add(group);
      this.presentBoxes.push(group);
    });
  }

  private buildSnow(): void {
    const count = 900;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (this.random() - 0.5) * 17;
      positions[i * 3 + 1] = this.random() * 12;
      positions[i * 3 + 2] = (this.random() - 0.5) * 17;
      speeds[i] = 0.35 + this.random() * 0.65;
      sizes[i] = 1 + this.random() * 1.4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.snow = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() }, uIntensity: { value: 1 } },
      vertexShader: `attribute float aSpeed;attribute float aSize;uniform float uTime;uniform float uPixelRatio;varying float vAlpha;void main(){vec3 p=position;p.y=mod(p.y-uTime*aSpeed+12.0,12.0)-.3;p.x+=sin(uTime*.45+position.y)*.28;p.z+=cos(uTime*.38+position.x)*.2;vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*32.0/-mv.z,1.0,6.0)*uPixelRatio;vAlpha=smoothstep(-.3,.4,p.y)*.72;}`,
      fragmentShader: `varying float vAlpha;uniform float uIntensity;void main(){float d=length(gl_PointCoord-.5);float alpha=(1.0-smoothstep(.12,.5,d))*vAlpha*uIntensity;if(alpha<.02)discard;gl_FragColor=vec4(.93,.97,1.,alpha);}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    }));
    this.snow.name = 'falling-snow';
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this.container.dataset.snow = 'true';
    this.container.dataset.snowIntensity = '1';
    this.container.dataset.autoRotate = 'true';
  }

  private buildCelebration(): void {
    const count = 200;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const delays = new Float32Array(count);
    const sizes = new Float32Array(count);
    const gold = new THREE.Color('#ffd68e');
    const white = new THREE.Color('#fff9e8');
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2;
      const radius = 0.7 + this.random() * 1.1;
      const speed = 0.45 + this.random() * 1.25;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 2.2 + this.random() * 2.4;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      velocities[i * 3] = Math.cos(angle) * speed;
      velocities[i * 3 + 1] = 0.8 + this.random() * 1.8;
      velocities[i * 3 + 2] = Math.sin(angle) * speed;
      (i % 3 === 0 ? white : gold).toArray(colors, i * 3);
      delays[i] = this.random() * 0.3;
      sizes[i] = 1.2 + this.random() * 2.1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.celebration = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uAge: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `
        attribute vec3 aVelocity;
        attribute vec3 color;
        attribute float aDelay;
        attribute float aSize;
        uniform float uAge;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float t = max(0.0, uAge - aDelay);
          vec3 p = position + aVelocity * t;
          p.y -= .85 * t * t;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * 55.0 / -mv.z, 1.0, 10.0) * uPixelRatio;
          vColor = color;
          vAlpha = (1.0 - smoothstep(1.0, 2.5, t)) * step(aDelay, uAge);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - .5);
          float alpha = (1.0 - smoothstep(.04, .5, d)) * vAlpha;
          if (alpha < .02) discard;
          gl_FragColor = vec4(vColor * 1.5, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    this.celebration.name = 'celebration-particles';
    this.celebration.visible = false;
    this.celebration.frustumCulled = false;
    this.scene.add(this.celebration);
  }

  private buildHandSnow(): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.handSnowPool.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.handSnowPool.opacities, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.handSnowPool.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.handSnow = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `
        attribute float aOpacity;
        attribute float aSize;
        uniform float uPixelRatio;
        varying float vOpacity;
        varying vec3 vColor;
        void main() {
          vOpacity = aOpacity;
          vColor = mix(vec3(1.0), vec3(.84, .93, 1.0), fract(aSize * .37));
          gl_Position = aOpacity > 0.0 ? vec4(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0);
          gl_PointSize = max(1.0, aSize * uPixelRatio);
        }
      `,
      fragmentShader: `
        varying float vOpacity;
        varying vec3 vColor;
        void main() {
          vec2 p = (gl_PointCoord - .5) * 2.0;
          float radius = length(p);
          float angle = atan(p.y, p.x + .00001);
          float arms = (1.0 - smoothstep(.04, .19, abs(sin(angle * 3.0)))) * (1.0 - smoothstep(.72, .98, radius));
          float center = 1.0 - smoothstep(.04, .22, radius);
          float alpha = max(arms, center) * vOpacity;
          if (alpha < .02) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    this.handSnow.name = 'hand-controlled-snow';
    this.handSnow.renderOrder = 10;
    this.handSnow.frustumCulled = false;
    this.scene.add(this.handSnow);
    this.syncHandSnow();
  }

  private readonly resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const distance = 12.7 * Math.max(1, 0.8 / this.camera.aspect);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    if (this.snow) this.snow.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    if (this.bulbGlow) this.bulbGlow.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    if (this.celebration) this.celebration.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    if (this.handSnow) this.handSnow.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.controls.update();
  };

  private start(): void {
    if (this.disposed || this.contextLost || document.hidden || this.frame !== null) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.animate);
  }

  private stop(): void {
    this.handSnowPool.stop();
    this.syncHandSnow();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly animate = (now: number): void => {
    this.frame = null;
    if (this.disposed || this.contextLost || document.hidden) return;
    const realDelta = Math.max((now - this.lastTime) / 1000, 0);
    const delta = Math.min(realDelta, 0.05);
    this.lastTime = now;
    this.elapsed += realDelta;
    this.handSnowPool.update(realDelta, now);
    this.syncHandSnow();
    if (!this.continuous) {
      if (this.growthPending) this.reveal = Math.min(this.reveal + realDelta / 1.7, 1);
      this.container.dataset.reveal = this.reveal.toFixed(3);
      const ease = 1 - Math.pow(1 - this.reveal, 3);
      this.tree.scale.set(0.6 + ease * 0.4, Math.max(ease, 0.001), 0.6 + ease * 0.4);
    }
    this.snow.material.uniforms.uTime.value = this.elapsed;
    this.bulbGlow.material.uniforms.uTime.value = this.elapsed;
    if (!this.continuous && this.growthPending && this.reveal >= 1) {
      this.growthPending = false;
      if (this.container.dataset.interactionStage === 'growing') this.container.dataset.interactionStage = 'ready';
      this.container.dispatchEvent(new Event('tree-growth-complete'));
    }
    this.updateCelebration();
    this.controls.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  private readonly visibilityChanged = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.stop();
    this.notice.hidden = false;
    this.notice.textContent = '图形渲染暂时中断，正在等待浏览器恢复…';
    this.container.dataset.sceneStatus = 'context-lost';
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.notice.hidden = true;
    this.container.dataset.sceneStatus = 'ready';
    this.resize();
    this.start();
  };
}
