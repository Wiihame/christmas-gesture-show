import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasThumbIndexContact, SnowGestureTracker } from '../src/snow-gesture.js';
import type { VisionHand } from '../src/vision-types.js';
import { createHand } from './fixtures/gesture-landmarks.js';

const inactive = { active: false, pointer: null };

function snowHand(handedness: VisionHand['handedness'] = 'Left'): VisionHand {
  const hand = createHand('None');
  hand.handedness = handedness;
  hand.landmarks[0] = { x: 0.5, y: 0.76, z: 0 };
  hand.landmarks[2] = { x: 0.37, y: 0.58, z: 0 };
  hand.landmarks[4] = { x: 0.46, y: 0.32, z: 0 };
  hand.landmarks[5] = { x: 0.43, y: 0.53, z: 0 };
  hand.landmarks[6] = { x: 0.44, y: 0.41, z: 0 };
  hand.landmarks[7] = { x: 0.455, y: 0.34, z: 0 };
  hand.landmarks[8] = { x: 0.47, y: 0.31, z: 0 };
  hand.landmarks[9] = { x: 0.50, y: 0.51, z: 0 };
  hand.landmarks[10] = { x: 0.50, y: 0.40, z: 0 };
  hand.landmarks[11] = { x: 0.49, y: 0.34, z: 0 };
  hand.landmarks[12] = { x: 0.48, y: 0.32, z: 0 };
  hand.landmarks[17] = { x: 0.60, y: 0.55, z: 0 };
  return hand;
}

function transformed(hand: VisionHand, scale = 1, dx = 0, dy = 0, aspect = 1): VisionHand {
  return { ...hand, landmarks: hand.landmarks.map((p) => ({ x: (p.x * scale + dx) / aspect, y: p.y * scale + dy, z: p.z * scale })) };
}

function withSpread(ratio: number): VisionHand {
  const hand = snowHand();
  const scale = 0.25;
  hand.landmarks[4] = { x: 0.46, y: 0.32, z: 0 };
  hand.landmarks[8] = { x: 0.46 + ratio * scale, y: 0.32, z: 0 };
  hand.landmarks[12] = { x: 0.46 + ratio * scale / 2, y: 0.32, z: 0 };
  return hand;
}

function center(hand: VisionHand) {
  return {
    x: [4, 8, 12].reduce((sum, i) => sum + hand.landmarks[i].x, 0) / 3,
    y: [4, 8, 12].reduce((sum, i) => sum + hand.landmarks[i].y, 0) / 3,
  };
}

test('three fingertips meeting enter immediately and expose their unmirrored center', () => {
  const hand = snowHand();
  assert.deepEqual(new SnowGestureTracker().update([hand], 0), { active: true, pointer: center(hand) });
});

test('pointer follows each fresh position without interpolation or top-only gating', () => {
  const tracker = new SnowGestureTracker();
  tracker.update([snowHand()], 0);
  const hand = transformed(snowHand(), 1, 0.15, 0.35);
  assert.deepEqual(tracker.update([hand], 330), { active: true, pointer: center(hand) });
});

test('geometry is palm-normalized, aspect-corrected, and accepts either hand', () => {
  for (const factor of [0.4, 1, 1.4]) {
    for (const aspect of [1, 4 / 3, 2]) {
      for (const handedness of ['Left', 'Right', 'Unknown'] as const) {
        const hand = transformed(snowHand(handedness), factor, 0.03, 0.02, aspect);
        assert.deepEqual(new SnowGestureTracker().update([hand], 0, aspect), { active: true, pointer: center(hand) });
      }
    }
  }
});

test('handedness confidence is not mistaken for landmark visibility', () => {
  const hand = snowHand('Unknown');
  hand.score = 0;
  hand.gestureScore = 0;
  assert.equal(new SnowGestureTracker().update([hand], 0).active, true);
});

test('ordinary thumb-index pinch with a raised or folded middle finger is not snow', () => {
  for (const y of [0.11, 0.55]) {
    const hand = snowHand();
    hand.landmarks[12] = { x: 0.5, y, z: 0 };
    assert.deepEqual(new SnowGestureTracker().update([hand], 0), inactive);
  }
});

test('all three pair distances matter, including the index-middle pair', () => {
  const hand = snowHand();
  hand.landmarks[4] = { x: 0.47, y: 0.32, z: 0 };
  hand.landmarks[8] = { x: 0.425, y: 0.32, z: 0 };
  hand.landmarks[12] = { x: 0.515, y: 0.32, z: 0 };
  assert.deepEqual(new SnowGestureTracker().update([hand], 0), inactive);
});

test('known fist and unclassified fingertips folded into the palm are rejected', () => {
  const classified = snowHand();
  classified.gesture = 'Closed_Fist';
  classified.gestureScore = 0.95;
  assert.deepEqual(new SnowGestureTracker().update([classified], 0), inactive);
  for (const y of [0.53, 0.63]) {
    const folded = snowHand();
    for (const i of [4, 8, 12]) folded.landmarks[i] = { x: 0.49 + i * 0.0005, y, z: 0 };
    assert.deepEqual(new SnowGestureTracker().update([folded], 0), inactive);
  }
});

test('spatial hysteresis tolerates small separation but release has no time grace', () => {
  const tracker = new SnowGestureTracker();
  assert.deepEqual(tracker.update([withSpread(0.31)], 0), inactive);
  assert.equal(tracker.update([withSpread(0.20)], 30).active, true);
  assert.equal(tracker.update([withSpread(0.31)], 60).active, true);
  assert.deepEqual(tracker.update([withSpread(0.42)], 90), inactive);
  assert.deepEqual(tracker.update([withSpread(0.31)], 120), inactive);
});

test('losing the selected hand stops immediately and reacquisition must meet entry geometry', () => {
  const tracker = new SnowGestureTracker();
  tracker.update([snowHand()], 0);
  assert.deepEqual(tracker.update([], 30), inactive);
  assert.deepEqual(tracker.update([withSpread(0.31)], 60), inactive);
  assert.equal(tracker.update([snowHand()], 90).active, true);
});

test('result order changes retain the selected active hand and its exit threshold', () => {
  for (const known of [true, false]) {
    const tracker = new SnowGestureTracker();
    const selected = snowHand(known ? 'Left' : 'Unknown');
    const other = transformed(snowHand(known ? 'Right' : 'Unknown'), 1, 0.4);
    tracker.update([selected, other], 0);
    const held = withSpread(0.31);
    held.handedness = selected.handedness;
    const result = tracker.update([other, held], 30);
    assert.deepEqual(result, { active: true, pointer: center(held) });
  }
});

test('any one valid hand can control snow but finger pairs cannot be combined across hands', () => {
  const invalid = snowHand();
  invalid.landmarks[12].y = 0.1;
  const valid = transformed(snowHand('Right'), 1, 0.25);
  assert.deepEqual(new SnowGestureTracker().update([invalid, valid], 0), { active: true, pointer: center(valid) });
  valid.landmarks[4].x -= 0.3;
  assert.deepEqual(new SnowGestureTracker().update([invalid, valid], 0), inactive);
});

test('invalid points, missing joints and degenerate palms cannot produce an active emitter', () => {
  const cases = [snowHand(), snowHand(), snowHand(), snowHand()];
  cases[0].landmarks[12].z = NaN;
  cases[1].landmarks.pop();
  delete cases[2].landmarks[4];
  cases[3].landmarks[17] = { ...cases[3].landmarks[5] };
  for (const hand of cases) assert.deepEqual(new SnowGestureTracker().update([hand], 0), inactive);
});

test('invalid or duplicate timestamps immediately stop and clear the held-pose latch', () => {
  for (const timestamp of [-1, NaN, Infinity, 30, 20]) {
    const tracker = new SnowGestureTracker();
    tracker.update([snowHand()], 30);
    assert.deepEqual(tracker.update([snowHand()], timestamp), inactive);
    assert.deepEqual(tracker.update([withSpread(0.31)], 60), inactive);
  }
});

test('long gaps, aspect changes and reset do not reuse the exit threshold', () => {
  const tracker = new SnowGestureTracker();
  tracker.update([snowHand()], 0);
  assert.deepEqual(tracker.update([withSpread(0.31)], 1_000), inactive);
  tracker.update([snowHand()], 1_030);
  assert.deepEqual(tracker.update([transformed(withSpread(0.31), 1, 0, 0, 2)], 1_060, 2), inactive);
  tracker.update([snowHand()], 1_090);
  tracker.reset();
  assert.deepEqual(tracker.update([withSpread(0.31)], 0), inactive);
  assert.equal(tracker.update([snowHand()], 30).active, true);
});

test('thumb-index contact keeps the post-snow mode lock through the pinch hysteresis band', () => {
  for (const ratio of [0.2, 0.31, 0.37]) {
    const hand = withSpread(ratio);
    hand.landmarks[12].y = 0.1; // Middle finger release stops snow, but this is not a fresh two-finger pinch.
    assert.deepEqual(new SnowGestureTracker().update([hand], 0), inactive);
    assert.equal(hasThumbIndexContact([hand]), true);
    assert.equal(hasThumbIndexContact([transformed(hand, 0.6, 0, 0, 2)], 2), true);
  }
  assert.equal(hasThumbIndexContact([withSpread(0.4)]), false);
});

test('thumb-index contact ignores missing and invalid hands', () => {
  assert.equal(hasThumbIndexContact([]), false);
  const invalid = snowHand();
  invalid.landmarks[8].x = NaN;
  assert.equal(hasThumbIndexContact([invalid]), false);
  assert.equal(hasThumbIndexContact([invalid, snowHand()]), true);
});

test('contact lock survives a fist classification or folded posture until tips actually separate', () => {
  const fist = snowHand();
  fist.gesture = 'Closed_Fist';
  assert.equal(hasThumbIndexContact([fist]), true);
  fist.gesture = 'None';
  fist.landmarks[4] = { x: 0.49, y: 0.63, z: 0 };
  fist.landmarks[8] = { x: 0.50, y: 0.63, z: 0 };
  assert.equal(hasThumbIndexContact([fist]), true);
  fist.landmarks[4].x -= 0.15;
  assert.equal(hasThumbIndexContact([fist]), false);
});
