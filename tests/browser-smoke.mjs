import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Pass an ego-browser Page and a local fixture directory. No physical camera is used.
export async function runCameraSmoke(page, { url, fixtureRoot }) {
  await page.goto(url);
  await page.waitForSelector('#start-button');
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    });
  });
  await page.click('#start-button');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('权限被拒绝'));
  const denied = await page.evaluate(() => ({
    startEnabled: !document.querySelector('#start-button').disabled,
    stopHidden: document.querySelector('#stop-button').hidden,
    videoReleased: [...document.querySelectorAll('video')].every((video) => video.srcObject === null),
  }));
  assert.deepEqual(denied, { startEnabled: true, stopHidden: true, videoReleased: true });

  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    window.__gestureSmoke = { canvas, context: canvas.getContext('2d'), image: null, stream: null, timer: null, frames: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          if (event.data.type === 'result') {
            window.__gestureSmoke.frames.push(event.data.frame);
            if (window.__gestureSmoke.frames.length > 30) window.__gestureSmoke.frames.shift();
          }
        });
      }
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const state = window.__gestureSmoke;
        state.timer = setInterval(() => state.context.drawImage(state.image, 0, 0), 33);
        state.stream = state.canvas.captureStream(30);
        return state.stream;
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [] });
  });

  const results = [];
  for (const [filename, count, gesture] of [
    ['official-right_hands.jpg', 2, 'Open_Palm'],
    ['official-fist.jpg', 1, 'Closed_Fist'],
    ['official-pointing_up.jpg', 1, 'Pointing_Up'],
  ]) {
    const data = `data:image/jpeg;base64,${(await readFile(join(fixtureRoot, filename))).toString('base64')}`;
    await page.evaluate(async (data) => {
      const state = window.__gestureSmoke;
      clearInterval(state.timer);
      state.image = new Image();
      state.image.src = data;
      await state.image.decode();
      state.canvas.width = state.image.width;
      state.canvas.height = state.image.height;
      state.context.drawImage(state.image, 0, 0);
      state.frames = [];
    }, data);
    await page.click('#start-button');
    await page.waitForFunction(({ count, gesture }) => {
      const frame = window.__gestureSmoke.frames.at(-1);
      return frame?.hands.length === count && frame.hands.some((hand) => hand.gesture === gesture);
    }, { count, gesture }, { timeout: 25_000 });
    const result = await page.evaluate(() => {
      const frame = window.__gestureSmoke.frames.at(-1);
      return {
        inferenceMs: frame.inferenceMs,
        hands: frame.hands.map((hand) => ({
          gesture: hand.gesture,
          confidence: hand.gestureScore,
          landmarkCount: hand.landmarks.length,
        })),
      };
    });
    assert.equal(result.hands.length, count);
    assert.ok(result.hands.every((hand) => hand.landmarkCount === 21));
    assert.ok(Number.isFinite(result.inferenceMs));
    results.push({ filename, expectedGesture: gesture, ...result });
    await page.click('#stop-button');
    const released = await page.evaluate(() => {
      const state = window.__gestureSmoke;
      clearInterval(state.timer);
      return state.stream.getTracks().every((track) => track.readyState === 'ended') && [...document.querySelectorAll('video')].every((video) => video.srcObject === null);
    });
    assert.ok(released, 'Stopping must release all video tracks');
  }

  return {
    url,
    recordedAt: new Date().toISOString(),
    physicalCameraTested: false,
    checks: ['denied-permission-recovery', 'two-hands', '21-landmarks-per-hand', 'open-palm', 'closed-fist', 'pointing-up', 'repeated-start-stop', 'video-track-release'],
    results,
  };
}
