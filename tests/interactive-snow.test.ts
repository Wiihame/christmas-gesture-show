import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InteractiveSnow } from '../src/interactive-snow.js';

function snow(capacity = 576): InteractiveSnow {
  return new InteractiveSnow(capacity, () => 0.5);
}

test('snow is born at the supplied screen x and emitter updates do not move existing particles', () => {
  const pool = snow();
  pool.setEmitter(0.25, 0);
  pool.update(0, 0);
  assert.equal(pool.spawnedCount, 1);
  assert.equal(pool.positions[0], 0.25);
  assert.ok(pool.positions[1] < 0);
  const previous = [...pool.positions];
  pool.setEmitter(0.8, 10);
  assert.deepEqual([...pool.positions], previous);
  pool.update(1 / 108, 20);
  assert.equal(pool.spawnedCount, 2);
  assert.ok(Math.abs(pool.positions[3] - 0.8) < 1e-6);
  assert.ok(pool.positions[0] < 0.3, 'Old snow must not jump to the new emitter');
});

test('null stops birth immediately while old snow falls, fades and never respawns', () => {
  const pool = snow();
  pool.setEmitter(0.4, 0);
  pool.update(0, 0);
  pool.setEmitter(null, 10);
  assert.equal(pool.active, false);
  assert.equal(pool.emitterX, null);
  pool.update(0.3, 310);
  assert.equal(pool.spawnedCount, 1);
  assert.equal(pool.particleCount, 1);
  assert.ok(pool.positions[1] > 0);
  assert.ok(pool.opacities[0] > 0);
  pool.update(6, 6310);
  assert.equal(pool.particleCount, 0);
  pool.update(20, 26310);
  assert.equal(pool.particleCount, 0);
  assert.equal(pool.spawnedCount, 1);
});

test('a missing gesture signal expires after 750ms without clearing existing snow', () => {
  const pool = snow();
  pool.setEmitter(0.5, 0);
  pool.update(0, 0);
  pool.update(0.1, 700);
  assert.equal(pool.active, true);
  const born = pool.spawnedCount;
  pool.update(0.05, 750);
  assert.equal(pool.active, false);
  assert.equal(pool.spawnedCount, born);
  assert.ok(pool.particleCount > 0);
});

test('fresh signals extend emission but older signals cannot replace the source', () => {
  const pool = snow();
  pool.setEmitter(0.2, 0);
  pool.update(0, 0);
  pool.setEmitter(0.7, 600);
  pool.setEmitter(0.1, 500);
  pool.update(0.01, 900);
  assert.equal(pool.active, true);
  assert.equal(pool.emitterX, 0.7);
});

test('long stalls do not backfill a burst even when a new signal arrives before the next frame', () => {
  const pool = snow();
  pool.setEmitter(0.2, 0);
  pool.update(0, 0);
  pool.setEmitter(0.8, 9990);
  pool.update(10, 10000);
  assert.equal(pool.spawnedCount, 6, 'Only the capped current-frame particles should be emitted after a stall');
  assert.equal(pool.particleCount, 5);
  assert.ok(Math.abs(pool.positions[3] - 0.8) < 1e-6);
});

test('a full pool drops new births instead of overwriting live snow or accumulating backlog', () => {
  const pool = snow(3);
  pool.setEmitter(0.2, 0);
  pool.update(0, 0);
  pool.setEmitter(0.8, 50);
  pool.update(0.05, 50);
  pool.update(0.05, 100);
  assert.equal(pool.particleCount, 3);
  assert.equal(pool.spawnedCount, 3);
  for (let time = 150; time <= 600; time += 50) {
    pool.setEmitter(0.8, time);
    pool.update(0.05, time);
  }
  assert.equal(pool.particleCount, 3);
  assert.equal(pool.spawnedCount, 3);
  assert.ok(pool.positions[0] < 0.3);
});

test('reset clears snow and the birth counter while reusing all renderer-facing buffers', () => {
  const pool = snow();
  const positions = pool.positions;
  const opacities = pool.opacities;
  const sizes = pool.sizes;
  pool.setEmitter(0.5, 0);
  pool.update(0, 0);
  pool.clear();
  assert.equal(pool.active, false);
  assert.equal(pool.particleCount, 0);
  assert.equal(pool.spawnedCount, 0);
  assert.ok(pool.opacities.every((opacity) => opacity === 0));
  pool.setEmitter(0.6, 0);
  pool.update(0, 0);
  assert.equal(pool.spawnedCount, 1);
  assert.equal(pool.positions, positions);
  assert.equal(pool.opacities, opacities);
  assert.equal(pool.sizes, sizes);
});

test('invalid coordinates stop emission and invalid deltas do not create snow', () => {
  const pool = snow();
  pool.setEmitter(2, 0);
  assert.equal(pool.emitterX, 1);
  pool.update(Number.NaN, 0);
  assert.equal(pool.spawnedCount, 0);
  pool.update(-1, 0);
  assert.equal(pool.spawnedCount, 0);
  pool.setEmitter(Number.NaN, 10);
  assert.equal(pool.active, false);
  pool.update(0.1, 110);
  assert.equal(pool.spawnedCount, 0);
});


test('triple-density emission sustains 108 flakes per second without filling the pool', () => {
  const pool = snow();
  for (let frame = 0; frame <= 600; ++frame) {
    const now = frame * 1000 / 60;
    pool.setEmitter(0.5, now);
    pool.update(frame === 0 ? 0 : 1 / 60, now);
  }
  assert.ok(pool.spawnedCount >= 1080 && pool.spawnedCount <= 1082);
  assert.ok(pool.particleCount > 300 && pool.particleCount < pool.capacity);
});
