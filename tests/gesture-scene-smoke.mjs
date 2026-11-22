import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** Runs the rendered app with synthetic camera frames and synthetic Worker results. */
export async function runGestureSceneSmoke(page, {
  url,
  fixtureRoot,
  screenshotDir,
  timeoutMs = 15_000,
  settledFrames = 6,
} = {}) {
  assert.ok(url, 'A running app URL is required');
  if (screenshotDir) {
    assert.ok(isAbsolute(screenshotDir), 'screenshotDir must be absolute');
    await mkdir(screenshotDir, { recursive: true });
  }
  const { createHand, createHeartHands } = await import(new URL('../.test-build/tests/fixtures/gesture-landmarks.js', import.meta.url));
  let background = null;
  if (fixtureRoot) {
    for (const filename of ['official-pointing_up.jpg', 'official-right_hands.jpg']) {
      try {
        background = `data:image/jpeg;base64,${(await readFile(join(fixtureRoot, filename))).toString('base64')}`;
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#christmas-viewport')?.dataset.ready === 'true', undefined, { timeout: timeoutMs });
  await page.evaluate(async ({ baseHand, background, heartHands }) => {
    if (!navigator.mediaDevices || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('Synthetic camera smoke requires a secure Chromium page with Canvas.captureStream');
    }
    const previous = window.__sceneGestureSmoke;
    previous?.cleanup?.();
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    let image = null;
    if (background) {
      image = new Image();
      image.src = background;
      await image.decode();
    }
    // Keep the synthetic pose anatomically consistent instead of moving only a
    // fingertip attached to the old fixture's arbitrary intermediate joints.
    baseHand.landmarks[0] = { x: 0.48, y: 0.72, z: 0 };
    baseHand.landmarks[1] = { x: 0.4, y: 0.65, z: 0 };
    baseHand.landmarks[2] = { x: 0.36, y: 0.60, z: 0 };
    baseHand.landmarks[3] = { x: 0.32, y: 0.55, z: 0 };
    baseHand.landmarks[4] = { x: 0.29, y: 0.52, z: 0 };
    baseHand.landmarks[5] = { x: 0.43, y: 0.53, z: 0 };
    baseHand.landmarks[8] = { x: 0.46, y: 0.25, z: 0 };
    for (const [base, x, y] of [[9, 0.48, 0.50], [13, 0.53, 0.515], [17, 0.57, 0.53]]) {
      baseHand.landmarks[base] = { x, y, z: 0 };
      baseHand.landmarks[base + 1] = { x: x + 0.01, y: y - 0.07, z: 0 };
      baseHand.landmarks[base + 2] = { x: x + 0.02, y, z: 0 };
      baseHand.landmarks[base + 3] = { x: x + 0.005, y: y + 0.045, z: 0 };
    }
    const aspect = canvas.width / canvas.height;
    const metricDistance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const palmScale = Math.max(metricDistance(baseHand.landmarks[5], baseHand.landmarks[17]), metricDistance(baseHand.landmarks[0], baseHand.landmarks[9]));
    const originalWorker = window.Worker;
    const originalCapture = Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getUserMedia');
    const originalEnumerate = Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'enumerateDevices');
    const state = {
      inputMode: 'synthetic-landmark-contract',
      baseHand,
      heartHands,
      canvas,
      aspect,
      scale: palmScale,
      origin: { ...baseHand.landmarks[8] },
      position: { ...baseHand.landmarks[8] },
      pose: 'pointing',
      queue: [],
      nextCommand: 0,
      completedCommand: 0,
      holdNextResult: false,
      heldResult: null,
      releaseHeld: null,
      processed: 0,
      samples: [],
      streams: [],
      workers: [],
      requests: [],
      tick: 0,
      raf: null,
      disposed: false,
      cleanup: null,
    };
    window.__sceneGestureSmoke = state;
    const viewportState = () => ({ ...document.querySelector('#christmas-viewport').dataset });
    const handsForPose = () => {
      if (state.pose === 'lost') return [];
      if (state.pose === 'heart') return structuredClone(state.heartHands);
      const hand = structuredClone(state.baseHand);
      if (state.pose === 'three-pinch' || state.pose === 'two-after-three-mid' || state.pose === 'two-after-three-tight' || state.pose === 'two-after-three-fist') {
        hand.gesture = state.pose === 'two-after-three-fist' ? 'Closed_Fist' : 'None';
        hand.landmarks[3] = { x: 0.455, y: 0.465, z: 0 };
        hand.landmarks[4] = { x: 0.494, y: 0.402, z: 0 };
        hand.landmarks[6] = { x: 0.43, y: 0.405, z: 0 };
        hand.landmarks[7] = { x: 0.48, y: 0.36, z: 0 };
        hand.landmarks[8] = { x: 0.5, y: 0.398, z: 0 };
        hand.landmarks[10] = { x: 0.51, y: 0.395, z: 0 };
        hand.landmarks[11] = { x: 0.54, y: 0.37, z: 0 };
        hand.landmarks[12] = { x: 0.506, y: 0.402, z: 0 };
        if (state.pose !== 'three-pinch') {
          const ratio = state.pose === 'two-after-three-mid' ? 0.32 : 0.1;
          hand.landmarks[4] = { ...hand.landmarks[8], x: hand.landmarks[8].x + state.scale * ratio / state.aspect };
          hand.landmarks[10] = { x: 0.48, y: 0.41, z: 0 };
          hand.landmarks[11] = { x: 0.48, y: 0.32, z: 0 };
          hand.landmarks[12] = { x: 0.48, y: 0.23, z: 0 };
        }
        // Translate all 21 points: the grip remains unchanged while the hand moves.
        const dx = state.position.x - state.origin.x;
        const dy = state.position.y - state.origin.y;
        hand.landmarks = hand.landmarks.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
        return [hand];
      }
      if (state.pose === 'fist' || state.pose === 'palm') {
        hand.gesture = state.pose === 'fist' ? 'Closed_Fist' : 'Open_Palm';
        hand.gestureScore = 0.99;
        for (const base of [5, 9, 13, 17]) {
          const root = hand.landmarks[base];
          const tip = state.pose === 'palm'
            ? { x: root.x, y: root.y - 0.27, z: 0 }
            : { x: root.x + 0.005, y: root.y + 0.045, z: 0 };
          hand.landmarks[base + 1] = { x: root.x, y: root.y - 0.09, z: 0 };
          hand.landmarks[base + 2] = state.pose === 'palm'
            ? { x: root.x, y: root.y - 0.19, z: 0 }
            : { x: root.x + 0.02, y: root.y, z: 0 };
          hand.landmarks[base + 3] = tip;
        }
        if (state.pose === 'fist') hand.landmarks[4] = { ...hand.landmarks[8], x: hand.landmarks[8].x + 0.005 };
        const dx = state.position.x - state.origin.x;
        const dy = state.position.y - state.origin.y;
        hand.landmarks = hand.landmarks.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
      } else {
        hand.landmarks[8] = { ...state.position, z: 0 };
        const root = hand.landmarks[5];
        for (const [index, fraction] of [[6, 0.4], [7, 0.7]]) {
          hand.landmarks[index] = {
            x: root.x + (state.position.x - root.x) * fraction,
            y: root.y + (state.position.y - root.y) * fraction,
            z: 0,
          };
        }
        if (state.pose === 'pinch') {
          hand.landmarks[4] = { ...hand.landmarks[8], x: hand.landmarks[8].x + state.scale * 0.1 / state.aspect };
          hand.gesture = 'None';
        }
      }
      return [hand];
    };
    const paint = () => {
      if (state.disposed) return;
      context.fillStyle = '#101816';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // A changing corner pixel keeps the synthetic video producing fresh frames.
      context.fillStyle = ++state.tick % 2 ? '#ffffff' : '#000000';
      context.fillRect(0, 0, 2, 2);
      state.raf = requestAnimationFrame(paint);
    };
    paint();

    window.Worker = class SyntheticVisionWorker extends EventTarget {
      terminated = false;
      constructor() {
        super();
        state.workers.push(this);
      }
      postMessage(request) {
        if (request.type === 'initialize') {
          queueMicrotask(() => {
            if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data: { type: 'initialized', id: request.id } }));
          });
          return;
        }
        if (request.type !== 'recognize') throw new Error(`Unexpected Worker request: ${request.type}`);
        request.bitmap.close();
        const command = state.queue.shift();
        if (command) {
          state.pose = command.pose;
          if (command.position) state.position = command.position;
        }
        const frame = { hands: handsForPose(), inferenceMs: 0.5 };
        const input = { pose: state.pose, position: { ...state.position } };
        const deliver = () => {
          if (this.terminated) return;
          this.dispatchEvent(new MessageEvent('message', { data: { type: 'result', id: request.id, frame } }));
          // VisionClient and the app each resolve a Promise before updating the DOM.
          queueMicrotask(() => queueMicrotask(() => {
            if (this.terminated) return;
            ++state.processed;
            if (command) state.completedCommand = command.id;
            state.samples.push({ observedAt: performance.now(), processed: state.processed, command: command?.id ?? null, ...input, ...viewportState() });
            if (state.samples.length > 2_000) state.samples.shift();
          }));
        };
        if (state.holdNextResult) {
          state.holdNextResult = false;
          state.heldResult = { id: request.id, frame, input };
          state.releaseHeld = () => {
            state.heldResult = null;
            state.releaseHeld = null;
            queueMicrotask(deliver);
          };
        } else queueMicrotask(deliver);
      }
      terminate() {
        this.terminated = true;
      }
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints) => {
        state.requests.push(constraints);
        const stream = canvas.captureStream(30);
        state.streams.push(stream);
        return stream;
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [] });
    state.cleanup = () => {
      state.disposed = true;
      if (state.raf !== null) cancelAnimationFrame(state.raf);
      state.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      state.workers.forEach((worker) => worker.terminate());
      state.heldResult = null;
      state.releaseHeld = null;
      state.holdNextResult = false;
      window.Worker = originalWorker;
      if (originalCapture) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', originalCapture);
      else delete navigator.mediaDevices.getUserMedia;
      if (originalEnumerate) Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', originalEnumerate);
      else delete navigator.mediaDevices.enumerateDevices;
    };
  }, { baseHand: createHand('Pointing_Up'), background, heartHands: createHeartHands() });

  const checks = [];
  const snapshots = [];
  const screenshots = [];
  const pathEvidence = [];
  const click = (selector) => page.evaluate((selector) => {
    const button = document.querySelector(selector);
    if (!button || button.disabled || button.hidden) throw new Error(`Button is not available: ${selector}`);
    button.click();
  }, selector);
  const snapshot = async (name) => {
    const result = await page.evaluate(() => {
      const data = { ...document.querySelector('#christmas-viewport').dataset };
      return {
        ...data,
        growth: Number(data.growthProgress),
        decoration: Number(data.decorationProgress),
        tiers: Number(data.tierCount),
        decorationLayers: Number(data.decorationLayerCount),
        snowActive: data.handSnowActive === 'true',
        snowEmitterX: data.handSnowActive === 'true' ? Number(data.handSnowEmitterX) : null,
        snowParticles: Number(data.handSnowParticleCount ?? 0),
        snowSpawned: Number(data.handSnowSpawnedCount ?? 0),
        mode: document.querySelector('#growth-mode').getAttribute('aria-pressed') === 'true' ? 'growth' : 'decoration',
        canvasCount: document.querySelectorAll('#christmas-viewport canvas[data-scene="christmas-tree"]').length,
        processed: window.__sceneGestureSmoke.processed,
      };
    });
    assert.ok(Number.isFinite(result.growth) && Number.isFinite(result.decoration), 'Scene exposes numeric progress');
    assert.equal(result.canvasCount, 1, 'Exactly one Three.js canvas remains mounted');
    snapshots.push({ name, ...result });
    return result;
  };
  const capture = async (name, { duringFireworks = false } = {}) => {
    if (!screenshotDir) return;
    if (duringFireworks) {
      await page.waitForFunction(() => {
        const data = document.querySelector('#christmas-viewport').dataset;
        return data.celebrationActive === 'true' && Number(data.celebrationAge) >= 0.25;
      }, undefined, { timeout: timeoutMs });
    } else {
      const live = await page.evaluate(() => !document.querySelector('#stop-button').hidden);
      if (live) await frames();
      assert.equal(await page.evaluate(() => window.__sceneGestureSmoke.queue.length), 0, 'Static screenshots are captured after the input path stops');
    }
    const celebrationActive = await page.evaluate(() => document.querySelector('#christmas-viewport').dataset.celebrationActive);
    const path = join(screenshotDir, `${name}.png`);
    await page.screenshot({ path });
    screenshots.push({ name, path, kind: duringFireworks ? 'fireworks' : 'static', celebrationActive });
  };
  const frames = async (count = settledFrames) => {
    const before = await page.evaluate(() => window.__sceneGestureSmoke.processed);
    await page.waitForFunction(({ before, count }) => window.__sceneGestureSmoke.processed >= before + count, { before, count }, { timeout: timeoutMs });
  };
  const visualFrames = async (count = 12) => {
    const before = await page.evaluate(() => window.__sceneGestureSmoke.tick);
    await page.waitForFunction(({ before, count }) => window.__sceneGestureSmoke.tick >= before + count, { before, count }, { timeout: timeoutMs });
  };
  const waitSnowActive = async (spawnedBefore) => {
    await page.waitForFunction((spawnedBefore) => {
      const data = document.querySelector('#christmas-viewport').dataset;
      return data.handSnowActive === 'true' && Number(data.handSnowSpawnedCount) > spawnedBefore;
    }, spawnedBefore, { timeout: timeoutMs });
  };
  const moveSnowSource = async (rawCenterX) => {
    const command = await page.evaluate((rawCenterX) => {
      const state = window.__sceneGestureSmoke;
      const start = { ...state.position };
      const target = { x: state.origin.x + rawCenterX - 0.5, y: state.origin.y };
      state.queue = Array.from({ length: 16 }, (_, index) => ({
        id: ++state.nextCommand,
        pose: 'three-pinch',
        position: { x: start.x + (target.x - start.x) * (index + 1) / 16, y: start.y + (target.y - start.y) * (index + 1) / 16 },
      }));
      return state.nextCommand;
    }, rawCenterX);
    await page.waitForFunction((command) => window.__sceneGestureSmoke.completedCommand >= command, command, { timeout: timeoutMs });
    await page.waitForFunction((expectedX) => {
      const data = document.querySelector('#christmas-viewport').dataset;
      return data.handSnowActive === 'true' && Math.abs(Number(data.handSnowEmitterX) - expectedX) < 0.02;
    }, 1 - rawCenterX, { timeout: timeoutMs });
  };
  const pose = async (nextPose) => {
    await page.evaluate((nextPose) => {
      const state = window.__sceneGestureSmoke;
      state.queue = [];
      state.pose = nextPose;
    }, nextPose);
    await frames();
  };
  const travel = async (type, { distance = 0.9, steps = 24, direction = 1, pose: inputPose = 'pointing', side = 0.18, radiusX = 0.24, radiusY = 0.025, drift = 0.15 } = {}) => {
    const batch = await page.evaluate(({ type, distance, steps, direction, inputPose, side, radiusX, radiusY, drift }) => {
      const state = window.__sceneGestureSmoke;
      const start = { ...state.position };
      const offsets = [];
      if (type === 'line') {
        for (let index = 1; index <= steps; ++index) offsets.push({ x: direction * distance * index / steps, y: 0 });
      } else if (type === 'rectangle') {
        let x = 0;
        let y = 0;
        for (const [dx, dy] of [[side, 0], [0, side], [-side, 0], [0, -side]]) {
          for (let index = 0; index < steps; ++index) {
            x += dx / steps;
            y += dy / steps;
            offsets.push({ x, y });
          }
        }
      } else if (type === 'flat-ellipse') {
        for (let index = 1; index <= steps; ++index) {
          const phase = 2 * Math.PI * index / steps;
          offsets.push({ x: radiusX * (Math.cos(phase) - 1) + drift * index / steps, y: radiusY * Math.sin(phase) });
        }
      } else if (type === 'jitter') {
        for (let index = 0; index < steps; ++index) offsets.push({ x: (index % 2 ? 1 : -1) * 0.001, y: (index % 2 ? -1 : 1) * 0.001 });
        offsets.push({ x: 0, y: 0 });
      } else throw new Error(`Unknown synthetic path: ${type}`);
      let previous = start;
      let normalizedDistance = 0;
      state.queue = offsets.map((offset) => {
        const position = { x: start.x + offset.x * state.scale / state.aspect, y: start.y + offset.y * state.scale };
        normalizedDistance += Math.hypot((position.x - previous.x) * state.aspect, position.y - previous.y) / state.scale;
        previous = position;
        return { id: ++state.nextCommand, pose: inputPose, position };
      });
      return { command: state.nextCommand, commandCount: state.queue.length, normalizedDistance };
    }, { type, distance, steps, direction, inputPose, side, radiusX, radiusY, drift });
    await page.waitForFunction((command) => window.__sceneGestureSmoke.completedCommand >= command, batch.command, { timeout: timeoutMs });
    return { type, ...batch };
  };
  const preserved = (before, after, message) => {
    assert.equal(after.growth, before.growth, `${message}: growth`);
    assert.equal(after.decoration, before.decoration, `${message}: decoration`);
    assert.equal(after.tiers, before.tiers, `${message}: tiers`);
    assert.equal(after.decorationLayers, before.decorationLayers, `${message}: decoration layers`);
    assert.equal(after.mode, before.mode, `${message}: mode`);
  };
  const closeCamera = async () => {
    await click('#stop-button');
    const released = await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      return state.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))
        && [...document.querySelectorAll('video')].every((video) => video.srcObject === null)
        && state.workers.every((worker) => worker.terminated);
    });
    assert.ok(released, 'Both previews, synthetic streams and Workers are released');
  };
  let finalStats;
  try {
    await click('#start-button');
    await frames();
    const initial = await snapshot('static-pointing');
    assert.equal(initial.growth, 0, 'Holding an upright finger must not grow the tree');
    assert.equal(initial.decoration, 0);
    assert.equal(initial.tiers, 0);
    await frames();
    preserved(initial, await snapshot('static-pointing-held'), 'Static pointing stays at zero');
    checks.push('static-pointing-zero-progress');
    await capture('01-static-pointing');

    await travel('jitter', { steps: 16 });
    preserved(initial, await snapshot('micro-jitter'), 'Spatial noise must not advance progress');
    await travel('line', { distance: 0.6, steps: 16, pose: 'fist' });
    preserved(initial, await snapshot('moving-fist'), 'Moving a closed fist keeps the operation switch off');
    await travel('line', { distance: 0.6, steps: 16, direction: -1, pose: 'palm' });
    preserved(initial, await snapshot('moving-open-palm'), 'Moving an open palm keeps the operation switch off');
    await pose('pointing');
    preserved(initial, await snapshot('pointing-reentered'), 'The first new pointing frame cannot catch up earlier movement');
    checks.push('micro-jitter-zero-progress', 'fist-and-palm-motion-disabled', 'pointing-reentry-no-jump');

    const firstPath = await travel('line');
    const firstLayer = await snapshot('first-palm-distance-segment');
    assert.ok(firstLayer.growth > 0.10 && firstLayer.growth < 0.18, 'A fixed palm-scale distance reveals the first partial layer');
    assert.equal(firstLayer.tiers, 1);
    pathEvidence.push({ name: 'first-growth-segment', ...firstPath, growthDelta: firstLayer.growth });
    await frames();
    preserved(firstLayer, await snapshot('stopped-after-first-segment'), 'Stopping must not continue growth');
    const secondPath = await travel('line', { direction: -1 });
    const secondLayer = await snapshot('second-palm-distance-segment');
    assert.ok(secondLayer.growth > 0.24 && secondLayer.growth < 0.35);
    assert.equal(secondLayer.tiers, 2);
    pathEvidence.push({ name: 'return-growth-segment', ...secondPath, growthDelta: secondLayer.growth - firstLayer.growth });
    checks.push('palm-scale-path-grows-layers', 'straight-return-motion-counts', 'stop-no-inertia');
    await capture('02-distance-growth-layers');

    await frames();
    const speedStart = await snapshot('speed-start');
    const slowPath = await travel('line', { distance: 0.32, steps: 16 });
    const slow = await snapshot('slow-movement-window');
    await frames();
    const fastPath = await travel('line', { distance: 0.64, steps: 16, direction: -1 });
    const fast = await snapshot('fast-movement-window');
    const slowAmount = slow.growth - speedStart.growth;
    const fastAmount = fast.growth - slow.growth;
    const speedRatio = fastAmount / slowAmount;
    assert.ok(slowAmount > 0 && speedRatio > 1.5 && speedRatio < 2.8, 'More fingertip travel in the same processed-frame count advances progress faster');
    pathEvidence.push({ name: 'slow-movement', ...slowPath, growthDelta: slowAmount }, { name: 'fast-movement', ...fastPath, growthDelta: fastAmount });
    checks.push('movement-rate-controls-progress');
    await frames();

    const beforeRectangle = await snapshot('before-rectangle');
    const rectanglePath = await travel('rectangle', { steps: 8 });
    const rectangle = await snapshot('rectangle-progress');
    assert.ok(rectangle.growth > beforeRectangle.growth, 'A rectangular path advances without circle fitting');
    pathEvidence.push({ name: 'rectangle', ...rectanglePath, growthDelta: rectangle.growth - beforeRectangle.growth });
    await frames();
    const ellipsePath = await travel('flat-ellipse', { steps: 64 });
    const ellipse = await snapshot('flat-ellipse-with-drift');
    assert.ok(ellipse.growth > rectangle.growth, 'A flat ellipse with a drifting center still counts as travel');
    pathEvidence.push({ name: 'flat-ellipse-center-drift', ...ellipsePath, growthDelta: ellipse.growth - rectangle.growth });
    checks.push('rectangular-motion-counts', 'flat-ellipse-and-drift-count');
    await frames();
    preserved(ellipse, await snapshot('all-paths-stopped'), 'Route shape does not introduce a progress tail');

    const beforeSnow = await snapshot('before-three-finger-snow');
    assert.equal(beforeSnow.mode, 'growth');
    await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      state.pose = 'three-pinch';
      state.holdNextResult = true;
    });
    await page.waitForFunction(() => window.__sceneGestureSmoke.heldResult !== null, undefined, { timeout: timeoutMs });
    const firstHeldAt = await page.evaluate(() => performance.now());
    await page.waitForFunction((heldAt) => performance.now() - heldAt >= 810, firstHeldAt, { timeout: timeoutMs });
    await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      state.pose = 'palm';
      state.releaseHeld();
    });
    await frames();
    const staleFirstSnow = await snapshot('first-snow-result-expired');
    assert.equal(staleFirstSnow.snowActive, false);
    assert.equal(staleFirstSnow.snowSpawned, beforeSnow.snowSpawned, 'A stale first result cannot start an emitter before any active-pose watchdog exists');
    preserved(beforeSnow, staleFirstSnow, 'Discarding an expired first snow signal preserves progress');
    checks.push('first-stale-snow-result-cannot-start');
    await pose('three-pinch');
    await waitSnowActive(beforeSnow.snowSpawned);
    preserved(beforeSnow, await snapshot('three-finger-snow-started'), 'Three-finger grip cannot grow the tree or select decoration');
    await moveSnowSource(0.75);
    const snowLeft = await snapshot('three-finger-snow-screen-left');
    assert.ok(Math.abs(snowLeft.snowEmitterX - 0.25) < 0.02, 'Raw right-hand position maps to the left screen emitter');
    preserved(beforeSnow, snowLeft, 'Moving the snow grip preserves tree progress and mode');
    await capture('07-three-finger-snow-left');
    await moveSnowSource(0.25);
    const snowRight = await snapshot('three-finger-snow-screen-right');
    assert.ok(Math.abs(snowRight.snowEmitterX - 0.75) < 0.02, 'Raw left-hand position maps to the right screen emitter');
    assert.ok(snowRight.snowSpawned > snowLeft.snowSpawned);
    preserved(beforeSnow, snowRight, 'Snow emission follows the hand without advancing progress');
    await capture('08-three-finger-snow-right');
    checks.push('three-finger-top-snow-mirrored-emitter', 'moving-snow-grip-preserves-progress');

    await pose('two-after-three-mid');
    const contactBand = await snapshot('three-to-two-contact-band');
    assert.equal(contactBand.snowActive, false);
    preserved(beforeSnow, contactBand, 'Lifting only the middle finger keeps the decoration release lock');
    await pose('two-after-three-fist');
    preserved(beforeSnow, await snapshot('snow-release-lock-with-fist-label'), 'A changed classification cannot unlock touching fingertips');
    await pose('two-after-three-tight');
    const stillLocked = await snapshot('three-to-two-retightened');
    assert.equal(stillLocked.snowActive, false);
    assert.equal(stillLocked.snowSpawned, contactBand.snowSpawned, 'Released middle finger stops spawning immediately');
    preserved(beforeSnow, stillLocked, 'Retightening from the 0.32 contact band cannot select decoration');
    await pose('palm');
    const fullyReleased = await snapshot('three-finger-fully-released');
    assert.equal(fullyReleased.snowSpawned, stillLocked.snowSpawned);
    await pose('pinch');
    const plainPinch = await snapshot('plain-pinch-after-three-release');
    assert.equal(plainPinch.mode, 'decoration', 'An ordinary two-finger pinch works after genuinely releasing contact');
    preserved({ ...beforeSnow, mode: 'decoration' }, plainPinch, 'Two-finger pinch selects mode without adding progress');
    await click('#growth-mode');
    await pose('pointing');
    preserved(beforeSnow, await snapshot('snow-test-growth-mode-restored'), 'Mode restore keeps the original progress');
    checks.push('three-to-two-contact-release-lock', 'snow-release-lock-survives-fist-label', 'plain-pinch-after-true-release');

    await pose('three-pinch');
    await waitSnowActive(fullyReleased.snowSpawned);
    await page.evaluate(() => { window.__sceneGestureSmoke.holdNextResult = true; });
    await page.waitForFunction(() => window.__sceneGestureSmoke.heldResult !== null, undefined, { timeout: timeoutMs });
    await page.waitForFunction(() => document.querySelector('#christmas-viewport').dataset.handSnowActive === 'false', undefined, { timeout: timeoutMs });
    const snowStaleWindowMs = await page.evaluate(() => performance.now() - window.__sceneGestureSmoke.samples.at(-1).observedAt);
    assert.ok(snowStaleWindowMs >= 700 && snowStaleWindowMs < 2_500, 'Missing results expire the snow source near the 750ms deadline');
    const staleSnow = await snapshot('snow-missing-results-expired');
    await visualFrames();
    const staleHeld = await snapshot('snow-stale-spawn-stable');
    assert.equal(staleHeld.snowSpawned, staleSnow.snowSpawned, 'A stalled Worker cannot keep creating snow');
    preserved(beforeSnow, staleHeld, 'The snow freshness timeout preserves progress');
    await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      state.pose = 'palm';
      state.queue = [];
      const release = state.releaseHeld;
      if (!release) throw new Error('The snow freshness test has no held result');
      release();
    });
    await frames();
    const staleReleased = await snapshot('late-three-finger-result-discarded');
    assert.equal(staleReleased.snowActive, false);
    assert.equal(staleReleased.snowSpawned, staleSnow.snowSpawned, 'An old three-finger result cannot restart the emitter');
    checks.push('snow-result-freshness-750ms', 'late-snow-result-does-not-restart');

    await pose('three-pinch');
    await waitSnowActive(staleReleased.snowSpawned);
    await pose('lost');
    const lostSnow = await snapshot('snow-hand-lost');
    assert.equal(lostSnow.snowActive, false);
    assert.ok(lostSnow.snowParticles > 0, 'Stopping new snow leaves the existing flakes to fall naturally');
    await visualFrames();
    assert.equal((await snapshot('snow-lost-spawn-stable')).snowSpawned, lostSnow.snowSpawned);
    await page.waitForFunction(() => Number(document.querySelector('#christmas-viewport').dataset.handSnowParticleCount) === 0, undefined, { timeout: timeoutMs });
    const drainedSnow = await snapshot('snow-existing-flakes-drained');
    assert.equal(drainedSnow.snowSpawned, lostSnow.snowSpawned);
    preserved(beforeSnow, drainedSnow, 'Natural snow completion does not alter either progress value');
    await pose('pointing');
    checks.push('snow-release-and-loss-stop-spawn', 'snow-old-flakes-finish-naturally');

    const beforePinch = await snapshot('before-pinch');
    await pose('pinch');
    const pinched = await snapshot('pinch-mode-selection');
    assert.equal(pinched.mode, 'decoration');
    assert.equal(pinched.growth, beforePinch.growth);
    assert.equal(pinched.decoration, beforePinch.decoration, 'Pinch selects a mode without adding decoration');
    await frames(settledFrames + 4);
    preserved(pinched, await snapshot('pinch-held'), 'A held pinch keeps mode and progress stable');
    checks.push('pinch-selects-mode-only', 'held-pinch-keeps-mode-and-progress');
    await capture('03-pinch-paused');

    await pose('pointing');
    preserved(pinched, await snapshot('pinch-released'), 'Releasing pinch must not jump progress');
    const decorationPath = await travel('line');
    const decoratedFirst = await snapshot('first-decoration-distance');
    assert.equal(decoratedFirst.growth, pinched.growth);
    assert.ok(decoratedFirst.decoration > 0.10 && decoratedFirst.decoration < 0.18);
    assert.equal(decoratedFirst.decorationLayers, 1);
    pathEvidence.push({ name: 'first-decoration-segment', ...decorationPath, decorationDelta: decoratedFirst.decoration });
    await frames();
    preserved(decoratedFirst, await snapshot('decoration-stopped'), 'Decoration stops with the hand');
    const decorationReturn = await travel('line', { direction: -1 });
    const decoratedWhole = await snapshot('second-decoration-distance');
    assert.ok(decoratedWhole.decoration > 0.24 && decoratedWhole.decoration < 0.35);
    assert.equal(decoratedWhole.decorationLayers, 2);
    pathEvidence.push({ name: 'return-decoration-segment', ...decorationReturn, decorationDelta: decoratedWhole.decoration - decoratedFirst.decoration });
    checks.push('movement-decorates-existing-layers', 'decoration-stop-no-inertia');
    await capture('04-distance-decoration-layers');

    const beforeHeld = await snapshot('before-held-worker-result');
    const delayedInput = await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      const origin = { ...state.position };
      state.queue = [{
        id: ++state.nextCommand,
        pose: 'pointing',
        position: { x: origin.x + state.scale * 0.4 / state.aspect, y: origin.y },
      }];
      state.holdNextResult = true;
      return { freshPosition: { x: origin.x - state.scale * 0.4 / state.aspect, y: origin.y } };
    });
    await page.waitForFunction(() => window.__sceneGestureSmoke.heldResult !== null, undefined, { timeout: timeoutMs });
    await click('#growth-mode');
    const switched = await snapshot('mode-switched-before-worker-release');
    preserved({ ...beforeHeld, mode: 'growth' }, switched, 'Changing mode preserves accumulated progress');
    await page.evaluate(({ freshPosition }) => {
      const state = window.__sceneGestureSmoke;
      const release = state.releaseHeld;
      if (!release) throw new Error('No held Worker result is available');
      state.position = freshPosition;
      state.pose = 'pointing';
      state.queue = [];
      release();
    }, delayedInput);
    await frames();
    preserved(switched, await snapshot('stale-result-discarded'), 'A result from before the mode switch cannot build the new movement anchor');
    await click('#decoration-mode');
    await frames();
    preserved(beforeHeld, await snapshot('mode-restored-after-stale-result'), 'Restoring mode also keeps both progress values');
    checks.push('mode-switch-discards-inflight-result');

    const beforeHeart = await snapshot('before-heart');
    assert.ok(beforeHeart.growth > 0 && beforeHeart.growth < 1 && beforeHeart.decoration > 0 && beforeHeart.decoration < 1, 'Heart is tested on a partially grown and partially decorated tree');
    const initialCelebrations = Number(beforeHeart.celebrationCount);
    await pose('heart');
    await page.waitForFunction((count) => Number(document.querySelector('#christmas-viewport').dataset.celebrationCount) === count, initialCelebrations + 1, { timeout: timeoutMs });
    const firstHeartWindowMs = await page.evaluate((count) => {
      const samples = window.__sceneGestureSmoke.samples;
      const first = samples.find((sample) => sample.pose === 'heart');
      const triggered = samples.find((sample) => sample.pose === 'heart' && Number(sample.celebrationCount) === count);
      if (!first || !triggered) throw new Error('Heart timing evidence is missing');
      return triggered.observedAt - first.observedAt;
    }, initialCelebrations + 1);
    assert.ok(firstHeartWindowMs >= 295, 'The first heart burst waits for the 300ms stability window');
    const firstFirework = await snapshot('heart-fireworks-active');
    assert.equal(firstFirework.celebrationActive, 'true');
    preserved(beforeHeart, firstFirework, 'Heart fireworks do not alter tree, mode or either progress value');
    await capture('05-heart-fireworks', { duringFireworks: true });
    await page.waitForFunction(() => document.querySelector('#christmas-viewport').dataset.celebrationActive === 'false', undefined, { timeout: timeoutMs });
    await frames(settledFrames + 12);
    const heldHeart = await snapshot('heart-held-after-fireworks');
    assert.equal(Number(heldHeart.celebrationCount), initialCelebrations + 1, 'Keeping the heart pose cannot repeat the burst after animation and cooldown');
    preserved(beforeHeart, heldHeart, 'Holding a heart keeps partial progress intact');
    await pose('pointing');
    preserved(beforeHeart, await snapshot('heart-released'), 'Releasing heart does not catch up movement');
    await pose('heart');
    await page.waitForFunction((count) => Number(document.querySelector('#christmas-viewport').dataset.celebrationCount) === count, initialCelebrations + 2, { timeout: timeoutMs });
    preserved(beforeHeart, await snapshot('heart-rearmed'), 'A new heart pose only adds a fireworks burst');
    await page.waitForFunction(() => document.querySelector('#christmas-viewport').dataset.celebrationActive === 'false', undefined, { timeout: timeoutMs });
    await pose('pointing');
    checks.push('heart-stable-window-300ms', 'heart-fireworks-preserve-partial-progress', 'held-heart-one-burst', 'released-heart-rearms');

    await pose('lost');
    preserved(decoratedWhole, await snapshot('hand-lost'), 'Losing the hand preserves progress');
    await pose('pointing');
    preserved(decoratedWhole, await snapshot('hand-reacquired-static'), 'Reacquisition does not replay old motion');
    checks.push('lost-hand-resume-no-jump');

    await click('#gesture-link-toggle');
    assert.equal(await page.evaluate(() => document.querySelector('#gesture-link-toggle').getAttribute('aria-pressed')), 'false');
    const unlinked = await snapshot('link-paused');
    await pose('three-pinch');
    await frames(settledFrames + 4);
    const pausedSnow = await snapshot('three-finger-snow-while-unlinked');
    assert.equal(pausedSnow.snowActive, false);
    assert.equal(pausedSnow.snowSpawned, unlinked.snowSpawned, 'Paused linkage cannot start new hand-controlled snow');
    preserved(unlinked, pausedSnow, 'Paused three-finger input cannot select decoration');
    await pose('palm');
    await pose('pointing');
    checks.push('paused-linkage-does-not-spawn-hand-snow');
    await travel('rectangle', { side: 0.2, steps: 6 });
    preserved(unlinked, await snapshot('movement-while-unlinked'), 'Unlinked motion must not advance progress');
    await pose('heart');
    await frames(settledFrames + 12);
    const pausedHeart = await snapshot('heart-while-unlinked');
    assert.equal(Number(pausedHeart.celebrationCount), initialCelebrations + 2, 'A heart pose while linkage is paused cannot launch fireworks');
    assert.equal(pausedHeart.celebrationActive, 'false');
    preserved(unlinked, pausedHeart, 'Paused heart also preserves mode and progress');
    await pose('pointing');
    checks.push('paused-heart-no-fireworks');
    await click('#gesture-link-toggle');
    await frames();
    preserved(unlinked, await snapshot('link-resumed-static'), 'Relinking preserves progress without catch-up');
    checks.push('link-pause-resume-preserves-progress');

    const beforeCameraSnow = await snapshot('before-camera-snow');
    await pose('three-pinch');
    await waitSnowActive(beforeCameraSnow.snowSpawned);
    const beforeClose = await snapshot('before-camera-close');
    await closeCamera();
    const cameraSnowStopped = await snapshot('camera-snow-stopped');
    assert.equal(cameraSnowStopped.snowActive, false);
    await visualFrames();
    assert.equal((await snapshot('camera-closed-snow-spawn-stable')).snowSpawned, cameraSnowStopped.snowSpawned, 'Closing the camera stops all new hand-controlled snow');
    await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      state.pose = 'pointing';
      state.queue = [];
    });
    checks.push('camera-close-stops-hand-snow');
    preserved(beforeClose, await snapshot('camera-closed'), 'Closing the camera preserves progress');
    await click('#start-button');
    await frames();
    preserved(beforeClose, await snapshot('camera-reopened-static'), 'Reopening the camera does not reset or advance progress');
    checks.push('camera-close-reopen-preserves-progress', 'camera-stream-worker-cleanup');

    const beforeLifecycle = await snapshot('before-persisted-lifecycle');
    await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      state.sceneCanvas = document.querySelector('#christmas-viewport canvas[data-scene="christmas-tree"]');
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForFunction(() => document.querySelector('#christmas-viewport')?.dataset.ready === 'true', undefined, { timeout: timeoutMs });
    preserved(beforeLifecycle, await snapshot('persisted-lifecycle-restored'), 'Persisted page lifecycle preserves the scene/controller state');
    assert.equal(await page.evaluate(() => window.__sceneGestureSmoke.sceneCanvas === document.querySelector('#christmas-viewport canvas[data-scene="christmas-tree"]')), true, 'Persisted lifecycle retains the same renderer canvas');
    checks.push('persisted-page-lifecycle-contract', 'single-scene-canvas');
    await capture('05-restored-progress');

    await click('#replay-tree');
    const reset = await snapshot('reset');
    assert.equal(reset.growth, 0);
    assert.equal(reset.decoration, 0);
    assert.equal(reset.tiers, 0);
    assert.equal(reset.decorationLayers, 0);
    assert.equal(reset.mode, 'growth');
    checks.push('explicit-reset-clears-progress');
    await capture('06-reset');

    const stopVisible = await page.evaluate(() => !document.querySelector('#stop-button').hidden);
    if (stopVisible) await closeCamera();
    finalStats = await page.evaluate(() => {
      const state = window.__sceneGestureSmoke;
      return {
        processedFrames: state.processed,
        completedCommands: state.completedCommand,
        workersCreated: state.workers.length,
        workersTerminated: state.workers.filter((worker) => worker.terminated).length,
        streamsReleased: state.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')),
        requestsVideoOnly: state.requests.every((constraints) => constraints.audio === false),
      };
    });
    assert.ok(finalStats.streamsReleased && finalStats.requestsVideoOnly);
    return {
      url,
      recordedAt: new Date().toISOString(),
      inputMode: 'synthetic-landmark-contract',
      physicalCameraTested: false,
      modelInferenceTested: false,
      speedRatio,
      evidenceSummary: {
        inputContract: 'upright-index-operation-switch-and-palm-normalized-travel',
        distanceToComplete: 6,
        suppressedInputs: ['static-pointing', 'micro-jitter', 'moving-fist', 'moving-open-palm'],
        acceptedPaths: ['straight-return', 'rectangle', 'flat-ellipse-with-center-drift'],
        lifecyclePreservesProgress: true,
        staleWorkerResultCannotBuildAnchor: true,
        heartPreservesPartialProgress: true,
        handSnowMirroredEmitter: { left: snowLeft.snowEmitterX, right: snowRight.snowEmitterX },
        snowStaleWindowMs,
        threeFingerReleaseLockTested: true,
        handSnowStopsAndDrainsNaturally: true,
        handSnowPausedAndCameraClosedDoNotSpawn: true,
        firstHeartWindowMs,
        heldHeartDoesNotRepeat: true,
        pausedHeartDoesNotFire: true,
        staticScreenshotsTakenAfterMotionStopped: true,
        fireworksScreenshotCapturedWhileActive: screenshots.some((shot) => shot.kind === 'fireworks' && shot.celebrationActive === 'true'),
      },
      pathEvidence,
      checks,
      snapshots,
      screenshots,
      ...finalStats,
    };
  } finally {
    await page.evaluate(() => {
      if (!document.querySelector('#stop-button').hidden) document.querySelector('#stop-button').click();
      window.__sceneGestureSmoke?.cleanup?.();
    });
  }
}
