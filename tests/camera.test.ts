import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CameraSession } from '../src/camera.js';

function streamFixture() {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => ++stopped }] } as unknown as MediaStream;
  return { stream, stopped: () => stopped };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('starts video only and releases the active device on stop', async () => {
  const fixture = streamFixture();
  let requested: MediaStreamConstraints | undefined;
  const camera = new CameraSession(async (constraints) => {
    requested = constraints;
    return fixture.stream;
  });
  assert.equal(await camera.start(), fixture.stream);
  assert.equal(requested?.audio, false);
  assert.deepEqual((requested?.video as MediaTrackConstraints).facingMode, { ideal: 'user' });
  camera.stop();
  camera.stop();
  assert.equal(fixture.stopped(), 1);
});

test('uses the explicitly selected camera', async () => {
  let requested: MediaStreamConstraints | undefined;
  const camera = new CameraSession(async (constraints) => {
    requested = constraints;
    return streamFixture().stream;
  });
  await camera.start('external-camera');
  assert.deepEqual((requested?.video as MediaTrackConstraints).deviceId, { exact: 'external-camera' });
  camera.stop();
});

test('stopping before the permission request completes releases the late stream', async () => {
  const pending = deferred<MediaStream>();
  const fixture = streamFixture();
  const camera = new CameraSession(() => pending.promise);
  const opening = camera.start();
  camera.stop();
  pending.resolve(fixture.stream);
  await assert.rejects(opening, { name: 'AbortError' });
  assert.equal(fixture.stopped(), 1);
});

test('an earlier permission result cannot replace or stop a newer session', async () => {
  const first = deferred<MediaStream>();
  const second = deferred<MediaStream>();
  const oldFixture = streamFixture();
  const newFixture = streamFixture();
  let calls = 0;
  const camera = new CameraSession(() => ++calls === 1 ? first.promise : second.promise);
  const earlier = camera.start();
  const latest = camera.start();
  second.resolve(newFixture.stream);
  assert.equal(await latest, newFixture.stream);
  first.resolve(oldFixture.stream);
  await assert.rejects(earlier, { name: 'AbortError' });
  assert.equal(oldFixture.stopped(), 1);
  assert.equal(newFixture.stopped(), 0);
  camera.stop();
  assert.equal(newFixture.stopped(), 1);
});

test('changing cameras releases the old device even if the new request fails', async () => {
  const fixture = streamFixture();
  let calls = 0;
  const camera = new CameraSession(async () => {
    if (++calls > 1) throw new DOMException('Denied', 'NotAllowedError');
    return fixture.stream;
  });
  await camera.start();
  await assert.rejects(camera.start(), { name: 'NotAllowedError' });
  assert.equal(fixture.stopped(), 1);
});
