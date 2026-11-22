import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MovementProgressController } from '../src/progress-controller.js';
import type { ContinuousGestureFrame } from '../src/continuous-gestures.js';

function setup() {
  const calls: Array<[string, number?]> = [];
  const controller = new MovementProgressController({
    startInteraction: () => calls.push(['reset']),
    setGrowthProgress: (value) => calls.push(['growth', value]),
    setDecorationProgress: (value) => calls.push(['decoration', value]),
  });
  return { controller, calls };
}
const move = (delta: number): ContinuousGestureFrame => ({ pointing: true, pinching: false, pinchStarted: false, movementDelta: delta, pointer: { x: 0.5, y: 0.3 } });
const pinch: ContinuousGestureFrame = { pointing: false, pinching: true, pinchStarted: true, movementDelta: 0, pointer: null };

test('a static pointing hand never starts an automatic growth animation', () => {
  const { controller, calls } = setup();
  controller.reset();
  for (let i = 0; i < 100; i++) controller.update(move(0));
  assert.equal(controller.state.growth, 0);
  assert.deepEqual(calls, [['reset']]);
});

test('normalized travel controls growth in six equal layers', () => {
  const { controller } = setup();
  controller.update(move(1));
  assert.ok(Math.abs(controller.state.growth - 1 / 6) < 1e-10);
  controller.update(move(1));
  assert.ok(Math.abs(controller.state.growth - 1 / 3) < 1e-10);
});

test('stop, missing pointing and invalid motion freeze both progress values', () => {
  const { controller, calls } = setup();
  controller.update(move(1));
  const snapshot = controller.state;
  const count = calls.length;
  controller.update(move(0));
  controller.update(move(NaN));
  controller.update(move(Infinity));
  controller.update(move(-1));
  controller.update({ ...move(1), pointing: false });
  controller.update({ ...move(1), pinching: true });
  assert.deepEqual(controller.state, snapshot);
  assert.equal(calls.length, count);
});

test('pinch only arms decoration; the next movement decorates without changing growth', () => {
  const { controller } = setup();
  controller.update(move(6));
  controller.update({ ...pinch, pointing: true, movementDelta: 1 });
  assert.deepEqual(controller.state, { mode: 'decoration', growth: 1, decoration: 0 });
  controller.update(move(1));
  assert.equal(controller.state.growth, 1);
  assert.ok(Math.abs(controller.state.decoration - 1 / 6) < 1e-10);
});

test('partial growth stays partial after pinch and limits available decoration', () => {
  const { controller } = setup();
  controller.update(move(2));
  controller.update(pinch);
  controller.update(move(20));
  assert.equal(controller.state.growth, 1 / 3);
  assert.equal(controller.state.decoration, 1 / 3);
});

test('mode buttons can resume growth without discarding decoration', () => {
  const { controller } = setup();
  controller.update(move(2));
  controller.update(pinch);
  controller.update(move(1));
  controller.setMode('growth');
  controller.update(move(1));
  assert.equal(controller.state.growth, 0.5);
  assert.equal(controller.state.decoration, 1 / 6);
});

test('reset clears both progress values and returns to growth mode', () => {
  const { controller, calls } = setup();
  controller.update(move(2));
  controller.update(pinch);
  controller.update(move(2));
  controller.reset();
  assert.deepEqual(controller.state, { mode: 'growth', growth: 0, decoration: 0 });
  assert.deepEqual(calls.at(-1), ['reset']);
});

test('progress clamps at completion and never allocates more scene updates when held', () => {
  const { controller, calls } = setup();
  controller.update(move(20));
  const count = calls.length;
  controller.update(move(1));
  assert.equal(controller.state.growth, 1);
  assert.equal(calls.length, count);
});


test('invalid completion distance cannot create invalid scene progress', () => {
  for (const distance of [0, -1, NaN, Infinity]) {
    assert.throws(() => new MovementProgressController({
      startInteraction() {}, setGrowthProgress() {}, setDecorationProgress() {},
    }, () => {}, distance));
  }
});
