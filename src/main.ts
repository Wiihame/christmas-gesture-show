import './styles.css';
import { CameraSession } from './camera';
import { drawHands } from './hand-overlay';
import { VisionClient } from './vision-client';
import type { VisionFrame } from './vision-types';
import { ChristmasScene } from './christmas-scene';
import { ContinuousGestureTracker, POINTING_CONFIDENCE } from './continuous-gestures';
import type { ContinuousGestureFrame } from './continuous-gestures';
import { MovementProgressController } from './progress-controller';
import { GestureInterpreter, isHeartPose } from './gestures';
import { SnowGestureTracker, hasThumbIndexContact } from './snow-gesture';

const cameraIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5 6.5 8H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2.5L16 5H8Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.5"/></svg>';
const handIcon = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M16 27V15a3 3 0 0 1 6 0v10-14a3 3 0 0 1 6 0v14-10a3 3 0 0 1 6 0v12-6a3 3 0 0 1 6 0v10c0 9-7 14-14 14-5 0-8-3-11-7l-7-9a3 3 0 0 1 5-4l3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="workspace">
    <header class="masthead">
      <a class="brand" href="./" aria-label="手势实验室首页"><span class="brand-mark">${handIcon}</span>Gesture Lab<span class="brand-divider">/</span><span class="brand-subtitle">手势实验室</span></a>
      <span class="step">第三步 <span>手势与动画</span></span>
    </header>

    <section class="intro scene-intro">
      <p class="eyebrow">一棵树，一个冬夜</p>
      <h1>让圣诞树亮起来<span>。</span></h1>
      <p class="intro-copy">竖起食指移动，树冠随动作一层层长起。画圈、画线、来回摆动都可以；捏合一下切到装饰，停手就停。双手比心放烟花，三指捏合左右移动撒下雪花。</p>
    </section>

    <section class="scene-panel" aria-labelledby="scene-title">
      <div class="panel-heading"><div class="scene-heading-copy"><h2 id="scene-title">圣诞树场景</h2><span id="interaction-state" class="interaction-state">预览中</span></div><span class="scene-instructions">拖动旋转 · 滚轮缩放</span></div>
      <div class="scene-viewport" id="christmas-viewport" aria-label="可旋转的三维圣诞树场景"><p id="scene-error" class="scene-error" role="status" hidden></p><div id="scene-camera-preview" class="scene-camera-preview" hidden><video id="scene-camera-video" autoplay muted playsinline aria-label="手势互动的小摄像头预览"></video><canvas id="scene-camera-overlay" aria-hidden="true"></canvas><span id="scene-camera-label">识别中</span></div></div>
      <div id="scene-progress" class="scene-progress" hidden>
        <div class="progress-item"><div><span>树冠生长</span><strong id="growth-percent">0%</strong></div><div id="growth-progress" class="progress-track" role="progressbar" aria-label="树冠生长进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>
        <div class="progress-item"><div><span>装饰进度</span><strong id="decoration-percent">0%</strong></div><div id="decoration-progress" class="progress-track" role="progressbar" aria-label="装饰进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>
        <div class="progress-modes"><button id="growth-mode" class="scene-toggle" aria-pressed="true">生长</button><button id="decoration-mode" class="scene-toggle" aria-pressed="false">装饰</button></div>
      </div>
      <div class="scene-controls">
        <div class="scene-toggles"><button id="lights-toggle" class="scene-toggle" aria-pressed="true">彩灯<span>开</span></button><button id="snow-toggle" class="scene-toggle" aria-pressed="true">环境飘雪<span>开</span></button><button id="rotation-toggle" class="scene-toggle" aria-pressed="true">自动旋转<span>开</span></button><button id="gesture-link-toggle" class="scene-toggle" aria-pressed="true">手势联动<span>开</span></button></div>
        <button id="replay-tree" class="primary-button">重播生长 <span aria-hidden="true">↻</span></button>
      </div>
    </section>

    <div class="section-label"><h2>摄像头与手势</h2><p>先举食指移动生长，再用拇指食指捏合切到装饰；移动多少就推进多少，停下即保留进度。</p></div>
    <div class="lab-layout">
      <section class="camera-panel" aria-labelledby="camera-title">
        <div class="panel-heading"><h2 id="camera-title">摄像头预览</h2><span class="live-indicator" id="live-indicator"><i></i><span>未开启</span></span></div>
        <div class="viewport" id="viewport">
          <video id="camera-video" autoplay muted playsinline aria-label="镜像摄像头预览"></video>
          <canvas id="hand-overlay" aria-hidden="true"></canvas>
          <div class="camera-placeholder" id="placeholder">
            <span class="camera-glyph">${cameraIcon}</span>
            <h3>准备好，举起你的手</h3>
            <p>开启后，你会看到镜像画面<br />以及跟随手指的骨架线条。</p>
          </div>
          <div class="viewport-corner top-left"></div><div class="viewport-corner top-right"></div><div class="viewport-corner bottom-left"></div><div class="viewport-corner bottom-right"></div>
          <span class="viewport-label">镜像预览</span><span class="viewport-label right">最多识别双手</span>
        </div>
        <div class="camera-controls">
          <label class="device-picker"><span>视频来源</span><select id="camera-select" aria-label="选择摄像头"><option value="">默认摄像头</option></select></label>
          <div class="buttons"><button id="stop-button" class="secondary-button" hidden>停止</button><button id="start-button" class="primary-button">${cameraIcon}<span>开启摄像头</span></button></div>
        </div>
        <p id="status" class="status-message" role="status" aria-live="polite">首次开启时，请允许浏览器使用摄像头。</p>
      </section>

      <aside class="recognition-panel" aria-labelledby="recognition-title">
        <div class="panel-heading"><h2 id="recognition-title">实时识别</h2><span class="count-label" id="hand-count">等待画面</span></div>
        <p id="gesture-action" class="gesture-action" role="status">开启摄像头后开始互动。</p>
        <div id="hand-results" class="hand-results"><div class="results-placeholder">${handIcon}<h3>等待你的第一个动作</h3><p>让手掌完整进入画面，<br />保持充足光线。</p></div></div>
        <div class="performance"><div><span>识别频率</span><strong id="recognition-rate">—</strong></div><div><span>单帧推理</span><strong id="inference-time">—</strong></div></div>
        <div class="gesture-guide"><p class="guide-title">连续操作，不用等动画播完</p><div class="gesture-examples"><div><span>01</span><strong>竖起食指并移动</strong><small>画圈、画线或来回摆动，光点跟着指尖走</small></div><div><span>02</span><strong>拇指食指捏合</strong><small>两指尖接触，也可以比 OK，切到装饰</small></div><div><span>03</span><strong>再举食指移动</strong><small>逐层增加彩灯和礼盒，停手即停</small></div><div><span>04</span><strong>双手比心放烟花</strong><small>双手食指与拇指围成心形，保持一下</small></div><div><span>05</span><strong>三指捏合落雪</strong><small>拇指、食指、中指捏在一起，在上方左右移动</small></div></div><details><summary>操作提示</summary><p>先长出树冠再捏合。食指竖起是操作开关，指尖移动距离决定推进量，不需要画标准的圆。</p><p>绿色光点表示生长，金色表示装饰，冰蓝色表示三指落雪，灰色表示联动暂停。移动时跟随，静止时进度不变。</p><p>双手比心保持约 0.3 秒即可放烟花。保持不放只触发一次，松开后再比心可再次触发；生长、装饰进度和当前模式都会保留。</p><p>三指捏合时，新雪花从场景顶部跟随手的位置落下；松开或手离开镜头就停止生成，已经落下的雪花会继续飘落。背景的环境飘雪可单独关闭。</p><p>从三指落雪切回装饰操作时，先完全松开，再用拇指、食指捏合。可点击生长 / 装饰切回相应模式；已经完成的进度会保留。</p></details></div>
      </aside>
    </div>

    <footer class="footer"><span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m8 1 5 2v4c0 4-5 7-5 7S3 11 3 7V3l5-2Z" stroke="currentColor"/><path d="m5.5 7.5 1.5 1.5 3-3" stroke="currentColor"/></svg>画面仅在本机处理，不会上传或录制</span><span>用一个动作，点亮一个冬夜</span></footer>
  </main>
`;

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const video = element<HTMLVideoElement>('camera-video');
const overlay = element<HTMLCanvasElement>('hand-overlay');
const placeholder = element<HTMLDivElement>('placeholder');
const startButton = element<HTMLButtonElement>('start-button');
const stopButton = element<HTMLButtonElement>('stop-button');
const deviceSelect = element<HTMLSelectElement>('camera-select');
const status = element<HTMLParagraphElement>('status');
const liveIndicator = element<HTMLSpanElement>('live-indicator');
const handResults = element<HTMLDivElement>('hand-results');
const sceneCameraVideo = element<HTMLVideoElement>('scene-camera-video');
const sceneCameraOverlay = element<HTMLCanvasElement>('scene-camera-overlay');
const sceneCameraPreview = element<HTMLDivElement>('scene-camera-preview');
const camera = new CameraSession();
let christmasScene: ChristmasScene | null = null;
let progressController: MovementProgressController | null = null;
const continuousTracker = new ContinuousGestureTracker();
const heartInterpreter = new GestureInterpreter();
const snowTracker = new SnowGestureTracker();
let currentSnow: ReturnType<SnowGestureTracker['update']> = { active: false, pointer: null };
let suppressDecorationPinch = false;
let cameraReady = false;
let gestureActive = false;
let hasInteraction = false;
let motionEpoch = 0;
let heartCandidate = false;
let heartTriggered = false;
let currentMotion: ContinuousGestureFrame = { pointing: false, pinching: false, pinchStarted: false, movementDelta: 0, pointer: null };

function resetContinuousMotion(): void {
  ++motionEpoch;
  continuousTracker.reset();
  heartInterpreter.reset();
  snowTracker.reset();
  currentSnow = { active: false, pointer: null };
  suppressDecorationPinch = false;
  christmasScene?.setHandSnowEmitter(null);
  heartCandidate = false;
  heartTriggered = false;
  currentMotion = { pointing: false, pinching: false, pinchStarted: false, movementDelta: 0, pointer: null };
  for (const canvas of [overlay, sceneCameraOverlay]) {
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function syncInteractionUI(): void {
  const state = progressController?.state;
  element('scene-progress').hidden = !hasInteraction;
  if (state) {
    for (const [name, progress] of [['growth', state.growth], ['decoration', state.decoration]] as const) {
      element(`${name}-percent`).textContent = `${(progress * 100).toFixed(1)}%`;
      const track = element(`${name}-progress`);
      track.setAttribute('aria-valuenow', (progress * 100).toFixed(1));
      (track.querySelector('i') as HTMLElement).style.width = `${progress * 100}%`;
    }
    element('growth-mode').setAttribute('aria-pressed', String(state.mode === 'growth'));
    element('decoration-mode').setAttribute('aria-pressed', String(state.mode === 'decoration'));
    const moving = gestureActive && currentMotion.movementDelta > 0;
    const label = state.mode === 'growth' ? '生长' : '装饰';
    const progress = state.mode === 'growth' ? state.growth : state.decoration;
    element('interaction-state').textContent = !hasInteraction ? '完整预览' : !gestureActive ? '已暂停 · 进度保留'
      : heartCandidate ? heartTriggered ? '比心已识别 · 烟花绽放' : '双手比心 · 保持一下'
      : currentSnow.active ? '三指捏合 · 跟手落雪'
      : currentMotion.pinching && suppressDecorationPinch ? '落雪已停止 · 松开后可切装饰'
      : currentMotion.pinching ? '捏合已识别 · 装饰已准备'
      : state.mode === 'growth' && state.growth === 1 ? '树冠完成 · 捏合后装饰'
      : state.mode === 'decoration' && state.growth === 0 ? '暂无树冠 · 切回生长移动'
      : state.mode === 'decoration' && state.decoration === state.growth ? '现有树冠已装饰'
      : `${label} ${(progress * 100).toFixed(1)}% · ${moving ? '跟随移动' : '停止推进'}`;
  }
  const replay = element<HTMLButtonElement>('replay-tree');
  if (replay.firstChild) replay.firstChild.textContent = hasInteraction ? '重新开始 ' : '重播预览 ';
  element<HTMLButtonElement>('lights-toggle').disabled = gestureActive;
  const data = element('christmas-viewport').dataset;
  for (const [id, value] of [['lights-toggle', data.lights], ['snow-toggle', data.snow], ['rotation-toggle', data.autoRotate]]) {
    if (value !== 'true' && value !== 'false') continue;
    const button = element<HTMLButtonElement>(id!);
    button.setAttribute('aria-pressed', value);
    button.querySelector('span')!.textContent = value === 'true' ? '开' : '关';
  }
}

function startGestureInteraction(reset = false): void {
  if (!cameraReady || !progressController) return;
  resetContinuousMotion();
  gestureActive = true;
  if (reset || !hasInteraction) {
    hasInteraction = true;
    progressController.reset();
  }
  christmasScene?.setSnow(true);
  christmasScene?.setAutoRotate(false);
  sceneCameraPreview.hidden = false;
  element('scene-camera-label').textContent = '识别中';
  element('gesture-action').textContent = '竖起食指移动生长，画圈、画线或摆动都可以；捏合后再移动装饰。';
  syncInteractionUI();
}

function stopGestureInteraction(): void {
  gestureActive = false;
  resetContinuousMotion();
  sceneCameraPreview.hidden = !cameraReady;
  syncInteractionUI();
}

function handleContinuousMotion(frame: VisionFrame, source: HTMLVideoElement): void {
  const now = performance.now();
  const heartPose = isHeartPose(frame.hands);
  heartCandidate = gestureActive && heartPose;
  if (!heartCandidate) heartTriggered = false;
  // Feed only heart candidates: legacy static gestures cannot drive the tree or its cooldown.
  const heartEvent = heartInterpreter.update(heartCandidate ? frame.hands : [], now);
  if (heartPose) {
    snowTracker.reset();
    currentSnow = { active: false, pointer: null };
    suppressDecorationPinch = false;
    continuousTracker.reset();
    currentMotion = { pointing: false, pinching: false, pinchStarted: false, movementDelta: 0, pointer: null };
    if (heartEvent === 'heart') {
      heartTriggered = true;
      christmasScene?.celebrate();
    }
  } else {
    const aspect = source.videoWidth / Math.max(1, source.videoHeight);
    currentSnow = snowTracker.update(frame.hands, now, aspect);
    if (currentSnow.active) {
      suppressDecorationPinch = true;
      continuousTracker.reset();
      currentMotion = { pointing: false, pinching: false, pinchStarted: false, movementDelta: 0, pointer: null };
    } else {
      currentMotion = continuousTracker.update(frame.hands, now, aspect, source.videoHeight);
      // Releasing just the middle finger must not turn a snow gesture into a new decoration command.
      if (suppressDecorationPinch) {
        currentMotion.pinchStarted = false;
        if (!hasThumbIndexContact(frame.hands, aspect)) suppressDecorationPinch = false;
      }
    }
  }
  // Scene coordinates follow the mirrored preview; the camera overlay still uses raw coordinates.
  christmasScene?.setHandSnowEmitter(gestureActive && currentSnow.active && currentSnow.pointer ? 1 - currentSnow.pointer.x : null);
  if (gestureActive) progressController?.update(currentMotion);
  const mode = progressController?.state.mode === 'decoration' ? '装饰' : '生长';
  const message = !gestureActive ? '联动已暂停，动作仍可识别；重新打开后继续当前进度。'
    : heartCandidate ? heartTriggered ? '比心已识别，烟花绽放！松开后再比心可再次触发，树冠和装饰进度保持不变。' : '检测到双手比心，保持一下即可放烟花；生长和装饰暂停推进。'
    : currentSnow.active ? '三指捏合已识别：左右移动控制顶部落雪位置；松开或离开镜头就停止生成新雪花。'
    : currentMotion.pinching && suppressDecorationPinch ? '落雪已停止；先松开拇指、食指，再捏合即可切换装饰。'
    : currentMotion.pinching ? '捏合已识别：再次竖起食指移动即可增加装饰。'
    : currentMotion.movementDelta > 0 ? `正在跟随指尖移动推进${mode}。`
    : currentMotion.pointing ? '食指已竖起，画圈、画线或摆动即可推进；静止时进度不变。' : '竖起食指并移动，或用拇指食指捏合切到装饰。';
  element('gesture-action').textContent = message;
  element('scene-camera-label').textContent = !gestureActive ? '联动暂停 · 进度保留'
    : heartCandidate ? heartTriggered ? '比心 · 烟花绽放' : '双手比心 · 保持一下'
    : currentSnow.active ? '三指捏合 · 跟手落雪'
    : currentMotion.pinching && suppressDecorationPinch ? '落雪已停止 · 先松开双指'
    : currentMotion.pinching ? '捏合 · 装饰已准备'
    : currentMotion.movementDelta > 0 ? `移动 · ${mode}` : currentMotion.pointing ? '食指竖起 · 进度暂停' : '等待操作手势';
  syncInteractionUI();
}

function mountChristmasScene(): void {
  const container = element<HTMLDivElement>('christmas-viewport');
  const error = element<HTMLParagraphElement>('scene-error');
  error.hidden = true;
  try {
    christmasScene = new ChristmasScene(container);
    progressController = new MovementProgressController(christmasScene, syncInteractionUI);
    christmasScene.setLights(element<HTMLButtonElement>('lights-toggle').getAttribute('aria-pressed') === 'true');
    christmasScene.setSnow(element<HTMLButtonElement>('snow-toggle').getAttribute('aria-pressed') === 'true');
    christmasScene.setAutoRotate(element<HTMLButtonElement>('rotation-toggle').getAttribute('aria-pressed') === 'true');
    container.dataset.ready = 'true';
  } catch {
    container.dataset.ready = 'false';
    error.textContent = '三维场景暂时无法启动，请使用支持 WebGL 的浏览器并开启硬件加速。摄像头识别仍可使用。';
    error.hidden = false;
  }
}

mountChristmasScene();
const sceneToggleHandlers: Array<[string, (enabled: boolean) => void]> = [
  ['lights-toggle', (enabled) => christmasScene?.setLights(enabled)],
  ['snow-toggle', (enabled) => christmasScene?.setSnow(enabled)],
  ['rotation-toggle', (enabled) => christmasScene?.setAutoRotate(enabled)],
];
for (const [id, update] of sceneToggleHandlers) {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener('click', () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('span')!.textContent = enabled ? '开' : '关';
    update(enabled);
  });
}
element<HTMLButtonElement>('replay-tree').addEventListener('click', () => {
  if (hasInteraction) {
    resetContinuousMotion();
    progressController?.reset();
    syncInteractionUI();
  } else christmasScene?.replay();
});
for (const [id, mode] of [['growth-mode', 'growth'], ['decoration-mode', 'decoration']] as const) {
  element(id).addEventListener('click', () => {
    resetContinuousMotion();
    progressController?.setMode(mode);
    syncInteractionUI();
  });
}
element<HTMLButtonElement>('gesture-link-toggle').addEventListener('click', () => {
  const button = element<HTMLButtonElement>('gesture-link-toggle');
  const enabled = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(enabled));
  button.querySelector('span')!.textContent = enabled ? '开' : '关';
  if (enabled) startGestureInteraction();
  else {
    stopGestureInteraction();
    element('gesture-action').textContent = '联动已暂停，生长和装饰进度已保留。';
    syncInteractionUI();
  }
});

function disposeChristmasScene(): void {
  christmasScene?.dispose();
  christmasScene = null;
  progressController = null;
}
window.addEventListener('pagehide', (event) => {
  // BFCache retains this document: preserve both progress and its rendered scene.
  if (!event.persisted) disposeChristmasScene();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !christmasScene) mountChristmasScene();
});

let generation = 0;
let activeVision: VisionClient | null = null;
let animationFrame: number | null = null;
let lastFrameTime = -1;
let lastSampleTime = -Infinity;
let sampleWindowStart = 0;
let sampleCount = 0;
let lastResultTime = 0;

const gestureLabels: Record<string, string> = {
  Open_Palm: '张开手掌',
  Closed_Fist: '握拳',
  Pointing_Up: '食指向上',
  Thumb_Up: '点赞',
  Thumb_Down: '拇指向下',
  Victory: 'V 手势',
  ILoveYou: '我爱你手语',
};

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function setIndicator(label: string, active = false): void {
  liveIndicator.querySelector('span')!.textContent = label;
  liveIndicator.classList.toggle('is-live', active);
}

function resetResults(message = '等待你的第一个动作'): void {
  handResults.innerHTML = `<div class="results-placeholder">${handIcon}<h3></h3><p>让手掌完整进入画面，<br />保持充足光线。</p></div>`;
  handResults.querySelector('h3')!.textContent = message;
  element('hand-count').textContent = '0 只手';
  element('recognition-rate').textContent = '—';
  element('inference-time').textContent = '—';
}

function renderFrame(frame: VisionFrame, source: HTMLVideoElement): void {
  handleContinuousMotion(frame, source);
  const controlPoint = currentSnow.pointer ?? currentMotion.pointer;
  const pointer = controlPoint ? {
    ...controlPoint,
    color: !gestureActive ? '#a9afb8' : currentSnow.active ? '#a8eaff' : progressController?.state.mode === 'decoration' ? '#ffd36a' : '#65efa3',
  } : null;
  drawHands(overlay, video, frame.hands, pointer);
  if (cameraReady) drawHands(sceneCameraOverlay, sceneCameraVideo, frame.hands, pointer);
  if (!frame.hands.length) element('scene-camera-label').textContent = '手掌暂时离开';
  element('hand-count').textContent = `${frame.hands.length} 只手`;
  element('inference-time').textContent = `${Math.round(frame.inferenceMs)} ms`;

  if (!frame.hands.length) {
    if (!handResults.querySelector('.results-placeholder')) {
      handResults.innerHTML = `<div class="results-placeholder">${handIcon}<h3>把手举到镜头前</h3><p>稍微退后，让整个手掌<br />都能出现在画面中。</p></div>`;
    }
    return;
  }

  handResults.replaceChildren(...frame.hands.map((hand, index) => {
    const card = document.createElement('article');
    card.className = `hand-card ${hand.handedness === 'Right' ? 'right-hand' : ''}`;
    const threshold = hand.gesture === 'Pointing_Up' ? POINTING_CONFIDENCE : 0.55;
    const label = Number.isFinite(hand.gestureScore) && hand.gestureScore >= threshold ? gestureLabels[hand.gesture] : undefined;
    card.innerHTML = '<div class="hand-card-top"><span class="hand-side"></span><span class="tracked">已追踪</span></div><h3></h3><div class="confidence-label"><span>手势置信度</span><strong></strong></div><div class="confidence-track"><i></i></div>';
    card.querySelector('.hand-side')!.textContent = hand.handedness === 'Left' ? '左手' : hand.handedness === 'Right' ? '右手' : `手 ${index + 1}`;
    card.querySelector('h3')!.textContent = label ?? '其他姿势';
    card.querySelector('strong')!.textContent = label ? `${Math.round(hand.gestureScore * 100)}%` : '—';
    (card.querySelector('.confidence-track i') as HTMLElement).style.width = `${label ? Math.min(100, Math.max(0, hand.gestureScore * 100)) : 0}%`;
    return card;
  }));
}

async function refreshDevices(token: number, currentDeviceId?: string): Promise<void> {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    if (token !== generation) return;
    deviceSelect.replaceChildren(new Option('默认摄像头', ''));
    devices.forEach((device, index) => deviceSelect.add(new Option(device.label || `摄像头 ${index + 1}`, device.deviceId)));
    if (currentDeviceId && devices.some((device) => device.deviceId === currentDeviceId)) deviceSelect.value = currentDeviceId;
  } catch {
    // 获取设备列表失败不影响已经开启的预览。
  }
}

function stopCamera(): void {
  ++generation;
  cameraReady = false;
  stopGestureInteraction();
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  activeVision?.close();
  activeVision = null;
  camera.stop();
  video.pause();
  video.srcObject = null;
  sceneCameraVideo.pause();
  sceneCameraVideo.srcObject = null;
  sceneCameraPreview.hidden = true;
  placeholder.hidden = false;
  startButton.disabled = false;
  startButton.querySelector('span')!.textContent = '开启摄像头';
  stopButton.hidden = true;
  deviceSelect.disabled = false;
  setIndicator('未开启');
  resetResults();
  element('gesture-action').textContent = hasInteraction ? '摄像头已停止，生长和装饰进度已保留。重新开启后继续。' : '摄像头已停止，可继续预览场景。';
}

function cameraError(error: unknown): string {
  if (!window.isSecureContext) return '请使用 localhost 或 HTTPS 打开页面，浏览器才能调用摄像头。';
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError': return '摄像头权限被拒绝。请在地址栏的网站权限中允许摄像头，然后重试。';
      case 'NotFoundError': return '没有找到摄像头，请连接设备后重试。';
      case 'NotReadableError': return '摄像头暂时无法使用，可能被其他应用占用。请关闭占用它的应用后重试。';
      case 'OverconstrainedError': return '所选摄像头不可用，请选择默认摄像头后重试。';
    }
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `启动或识别失败：${detail}。请重新开启摄像头；若持续失败，请检查识别资源是否已加载。`;
}

function scheduleFrames(token: number, vision: VisionClient): void {
  const sample = (now: number) => {
    if (token !== generation) return;
    animationFrame = requestAnimationFrame(sample);
    if (currentSnow.active && now - lastResultTime > 750) {
      // A stalled result must neither keep emitting nor restart snow when it finally arrives.
      resetContinuousMotion();
      syncInteractionUI();
      element('gesture-action').textContent = '手部追踪暂时中断，已停止生成新雪花。';
      element('scene-camera-label').textContent = '等待新的手部位置';
    }
    if (document.hidden || now - lastSampleTime < 50) return;
    const previewBounds = sceneCameraPreview.getBoundingClientRect();
    const source = !sceneCameraPreview.hidden && previewBounds.bottom > 0 && previewBounds.top < innerHeight ? sceneCameraVideo : video;
    if (source.readyState < 2 || source.currentTime === lastFrameTime) return;
    lastSampleTime = now;
    lastFrameTime = source.currentTime;

    const frameEpoch = motionEpoch;
    void vision.recognize(source, now).then((frame) => {
      if (token !== generation || frameEpoch !== motionEpoch || !frame || document.hidden) return;
      const receivedAt = performance.now();
      if (receivedAt - now > 750) {
        // Also reject a stale first result: no snow was active for the RAF watchdog to stop.
        resetContinuousMotion();
        syncInteractionUI();
        element('gesture-action').textContent = '这帧手部位置已过期，等待新的识别结果。';
        element('scene-camera-label').textContent = '等待新的手部位置';
        return;
      }
      lastResultTime = receivedAt;
      renderFrame(frame, source);
      ++sampleCount;
      const elapsed = lastResultTime - sampleWindowStart;
      if (elapsed >= 1000) {
        element('recognition-rate').textContent = `${Math.round(sampleCount * 1000 / elapsed)} fps`;
        sampleWindowStart = lastResultTime;
        sampleCount = 0;
      }
    }).catch((error: unknown) => {
      if (token !== generation) return;
      stopCamera();
      setStatus(cameraError(error), true);
    });
  };
  sample(performance.now());
}

async function startCamera(): Promise<void> {
  if (activeVision) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(window.isSecureContext ? '当前浏览器不支持摄像头，请使用桌面版 Chrome 或 Edge。' : '请使用 localhost 或 HTTPS 打开页面，浏览器才能调用摄像头。', true);
    return;
  }

  const token = ++generation;
  const vision = new VisionClient();
  activeVision = vision;
  startButton.disabled = true;
  startButton.querySelector('span')!.textContent = '正在开启…';
  stopButton.hidden = false;
  deviceSelect.disabled = true;
  setIndicator('准备中');
  setStatus('请允许浏览器使用摄像头。你可以随时点击停止。');

  try {
    const stream = await camera.start(deviceSelect.value || undefined);
    if (token !== generation) return;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (token !== generation) return;
      stopCamera();
      setStatus('摄像头已断开，请检查连接后重新开启。', true);
    }, { once: true });
    video.srcObject = stream;
    await video.play();
    if (token !== generation) return;
    sceneCameraVideo.srcObject = stream;
    void sceneCameraVideo.play().catch(() => { if (token === generation) sceneCameraPreview.hidden = true; });
    placeholder.hidden = true;
    setStatus('摄像头已开启，正在加载本地手势模型…');
    void refreshDevices(token, stream.getVideoTracks()[0]?.getSettings().deviceId);

    await vision.initialize();
    if (token !== generation) return;
    cameraReady = true;
    if (element('gesture-link-toggle').getAttribute('aria-pressed') === 'true') startGestureInteraction();
    else sceneCameraPreview.hidden = false;
    element('christmas-viewport').closest('.scene-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setIndicator('识别中', true);
    startButton.querySelector('span')!.textContent = '摄像头已开启';
    setStatus('识别已就绪。竖起食指移动控制生长，捏合后再移动控制装饰；画圈、画线或摆动都可以，静止就停。');
    resetResults('把手举到镜头前');
    lastFrameTime = -1;
    lastSampleTime = -Infinity;
    sampleWindowStart = performance.now();
    lastResultTime = sampleWindowStart;
    sampleCount = 0;
    scheduleFrames(token, vision);
  } catch (error) {
    if (token !== generation) return;
    stopCamera();
    setStatus(cameraError(error), true);
  }
}

startButton.addEventListener('click', () => void startCamera());
stopButton.addEventListener('click', () => {
  stopCamera();
  setStatus('摄像头已停止，设备已释放。');
});
window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (!activeVision || startButton.textContent?.includes('正在')) return;
  if (document.hidden) {
    resetContinuousMotion();
    syncInteractionUI();
    setIndicator('已暂停');
  } else {
    sampleWindowStart = performance.now();
    sampleCount = 0;
    setIndicator('识别中', true);
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopCamera();
    disposeChristmasScene();
  });
}
