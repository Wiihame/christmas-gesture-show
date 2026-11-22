import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnimationController } from '../src/animation-controller.js';

function setup() {
  const calls: string[] = [];
  const controller = new AnimationController({
    startInteraction: () => calls.push('reset'),
    setSnow: (enabled) => calls.push(`snow:${enabled}`),
    growTree: () => calls.push('grow'),
    decorate: () => calls.push('decorate'),
    celebrate: () => calls.push('celebrate'),
  });
  return { controller, calls };
}

test('open palm wakes the scene, pointing grows it, two palms decorate it', () => {
  const { controller, calls } = setup();
  controller.reset();
  controller.handleGesture('open-palm');
  assert.equal(controller.stage, 'active');
  controller.handleGesture('pointing-up');
  assert.equal(controller.stage, 'growing');
  controller.growthCompleted();
  controller.handleGesture('two-palms');
  assert.equal(controller.stage, 'decorated');
  assert.deepEqual(calls, ['reset', 'snow:true', 'grow', 'decorate']);
});

test('pointing can grow directly and does not restart unfinished growth', () => {
  const { controller, calls } = setup();
  controller.handleGesture('pointing-up');
  controller.handleGesture('pointing-up');
  assert.deepEqual(calls, ['grow']);
  controller.growthCompleted();
  controller.handleGesture('pointing-up');
  assert.deepEqual(calls, ['grow', 'grow']);
});

test('an early two-palm event is performed once after growth', () => {
  const { controller, calls } = setup();
  controller.handleGesture('pointing-up');
  controller.handleGesture('two-palms');
  assert.deepEqual(calls, ['grow']);
  controller.growthCompleted();
  controller.growthCompleted();
  assert.deepEqual(calls, ['grow', 'decorate']);
});

test('early heart takes priority over a queued decoration', () => {
  const { controller, calls } = setup();
  controller.handleGesture('pointing-up');
  controller.handleGesture('two-palms');
  controller.handleGesture('heart');
  controller.handleGesture('two-palms');
  controller.growthCompleted();
  assert.deepEqual(calls, ['grow', 'celebrate']);
  assert.equal(controller.stage, 'celebrating');
  controller.celebrationCompleted();
  assert.equal(controller.stage, 'decorated');
});

test('reset and stop discard pending actions; late completions cannot resurrect them', () => {
  const { controller, calls } = setup();
  controller.handleGesture('pointing-up');
  controller.handleGesture('heart');
  controller.reset();
  controller.growthCompleted();
  assert.deepEqual(calls, ['grow', 'reset']);
  assert.equal(controller.stage, 'waiting');
  controller.handleGesture('pointing-up');
  controller.handleGesture('two-palms');
  controller.cancelPending();
  controller.growthCompleted();
  assert.deepEqual(calls, ['grow', 'reset', 'grow']);
  assert.equal(controller.stage, 'ready');
});

test('heart before the tree exists cannot show celebration assets', () => {
  const { controller, calls } = setup();
  controller.handleGesture('heart');
  assert.deepEqual(calls, []);
  assert.equal(controller.stage, 'waiting');
});
