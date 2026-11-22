import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GestureInterpreter, isHeartPose } from '../src/gestures.js';
import type { VisionHand } from '../src/vision-types.js';
import { createHand as hand, createHeartHands as heartHands, referenceMotionSamples, correctedReferenceSamples } from './fixtures/gesture-landmarks.js';

type Point = VisionHand['landmarks'][number];

function transform(hands: VisionHand[], scale: number, dx = 0, dy = 0): VisionHand[] {
  return hands.map((item) => ({
    ...item,
    landmarks: item.landmarks.map(({ x, y, z }) => ({
      x: 0.5 + (x - 0.5) * scale + dx,
      y: 0.5 + (y - 0.5) * scale + dy,
      z: z * scale,
    })),
  }));
}

test('a gesture needs 180ms stability and emits once while held', () => {
  const interpreter = new GestureInterpreter();
  const hands = [hand('Open_Palm')];
  assert.equal(interpreter.update(hands, 0), null);
  assert.equal(interpreter.update(hands, 179), null);
  assert.equal(interpreter.update(hands, 180), 'open-palm');
  assert.equal(interpreter.update(hands, 1_500), null);
  assert.equal(interpreter.update(hands, 5_000), null);
});

test('brief gestures and low-confidence classifications do not trigger', () => {
  const interpreter = new GestureInterpreter();
  assert.equal(interpreter.update([hand('Open_Palm', 0.54)], 0), null);
  assert.equal(interpreter.update([hand('Open_Palm', 0.54)], 500), null);
  assert.equal(interpreter.update([hand('Open_Palm', 0.55)], 600), null);
  assert.equal(interpreter.update([], 700), null);
  assert.equal(interpreter.update([hand('Pointing_Up')], 800), null);
  assert.equal(interpreter.update([hand('Pointing_Up')], 979), null);
  assert.equal(interpreter.update([hand('Pointing_Up')], 980), 'pointing-up');
});

test('None releases a gesture so it can trigger again after cooldown', () => {
  const interpreter = new GestureInterpreter();
  const palms = [hand('Open_Palm')];
  interpreter.update(palms, 0);
  assert.equal(interpreter.update(palms, 180), 'open-palm');
  assert.equal(interpreter.update([hand('None')], 200), null);
  assert.equal(interpreter.update(palms, 300), null);
  assert.equal(interpreter.update(palms, 1_179), null);
  assert.equal(interpreter.update(palms, 1_180), 'open-palm');
  assert.equal(interpreter.update(palms, 2_500), null);
});

test('cooldown preserves a new stable candidate instead of consuming its event', () => {
  const interpreter = new GestureInterpreter();
  interpreter.update([hand('Open_Palm')], 0);
  assert.equal(interpreter.update([hand('Open_Palm')], 180), 'open-palm');
  assert.equal(interpreter.update([hand('Pointing_Up')], 220), null);
  assert.equal(interpreter.update([hand('Pointing_Up')], 400), null);
  assert.equal(interpreter.update([hand('Pointing_Up')], 1_179), null);
  assert.equal(interpreter.update([hand('Pointing_Up')], 1_180), 'pointing-up');
});

test('two palms have priority over one palm and array order does not reset stability', () => {
  const interpreter = new GestureInterpreter();
  const palms = [hand('Open_Palm'), hand('Open_Palm')];
  assert.equal(interpreter.update(palms, 0), null);
  assert.equal(interpreter.update([...palms].reverse(), 180), 'two-palms');
  assert.equal(interpreter.update(palms, 1_500), null);
});

test('pointing up has priority over an open palm', () => {
  const interpreter = new GestureInterpreter();
  const hands = [hand('Open_Palm'), hand('Pointing_Up')];
  assert.equal(interpreter.update(hands, 0), null);
  assert.equal(interpreter.update(hands, 180), 'pointing-up');
});

test('losing one hand immediately cancels the two-palms candidate', () => {
  const interpreter = new GestureInterpreter();
  const palms = [hand('Open_Palm'), hand('Open_Palm')];
  interpreter.update(palms, 0);
  assert.equal(interpreter.update([palms[0]], 100), null);
  assert.equal(interpreter.update(palms, 150), null);
  assert.equal(interpreter.update(palms, 329), null);
  assert.equal(interpreter.update(palms, 330), 'two-palms');
});

test('heart geometry is independent of handedness labels and result order', () => {
  const hands = heartHands();
  assert.equal(isHeartPose(hands), true);
  assert.equal(isHeartPose([...hands].reverse()), true);
  hands[0].handedness = 'Unknown';
  hands[1].handedness = 'Unknown';
  assert.equal(isHeartPose(hands), true);
});

test('heart geometry remains valid under translation and image scaling', () => {
  for (const scale of [0.4, 0.75, 1, 1.5, 2]) {
    assert.equal(isHeartPose(transform(heartHands(), scale, 0.03, -0.04)), true, `scale ${scale}`);
  }
});

test('a heart needs 300ms stability and has priority over basic model labels', () => {
  const interpreter = new GestureInterpreter();
  const hands = heartHands();
  hands[0].gesture = 'Open_Palm';
  hands[1].gesture = 'Pointing_Up';
  assert.equal(interpreter.update(hands, 0), null);
  assert.equal(interpreter.update(hands, 299), null);
  assert.equal(interpreter.update([...hands].reverse(), 300), 'heart');
  assert.equal(interpreter.update(hands, 2_000), null);
});

test('losing one hand immediately cancels the heart stability window', () => {
  const interpreter = new GestureInterpreter();
  const hands = heartHands();
  interpreter.update(hands, 0);
  assert.equal(interpreter.update([hands[0]], 200), null);
  assert.equal(interpreter.update(hands, 250), null);
  assert.equal(interpreter.update(hands, 549), null);
  assert.equal(interpreter.update(hands, 550), 'heart');
});

test('two open palms and two pointing-up classifications are not hearts', () => {
  for (const gesture of ['Open_Palm', 'Pointing_Up']) {
    const hands = heartHands();
    hands.forEach((item) => { item.gesture = gesture; });
    assert.equal(isHeartPose(hands), false, gesture);
  }
  assert.equal(isHeartPose([hand('Open_Palm'), hand('Open_Palm')]), false);
});

test('straight meeting index fingers cannot form a heart even with unclassified gestures', () => {
  const hands = heartHands();
  for (const item of hands) {
    const start = item.landmarks[5];
    const end = item.landmarks[8];
    for (const [index, fraction] of [[6, 1 / 3], [7, 2 / 3]]) {
      item.landmarks[index] = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction, z: 0 };
    }
  }
  assert.equal(isHeartPose(hands), false);
});

test('a single ILoveYou classification does not substitute for a two-hand heart', () => {
  assert.equal(isHeartPose([hand('ILoveYou')]), false);
  const interpreter = new GestureInterpreter();
  assert.equal(interpreter.update([hand('ILoveYou')], 0), null);
  assert.equal(interpreter.update([hand('ILoveYou')], 1_000), null);
});

test('a heart requires both fingertip joins and an upright opening', () => {
  const separated = heartHands();
  separated[1].landmarks[8].x += 0.2;
  assert.equal(isHeartPose(separated), false);
  const inverted = heartHands();
  for (const item of inverted) {
    const thumbY = item.landmarks[4].y;
    item.landmarks[4].y = item.landmarks[8].y;
    item.landmarks[8].y = thumbY;
  }
  assert.equal(isHeartPose(inverted), false);
});

test('invalid, incomplete, sparse or degenerate landmarks are rejected', () => {
  const invalidPoints: Array<(points: Point[]) => void> = [
    (points) => { points[4].x = NaN; },
    (points) => { points[12].z = Infinity; },
    (points) => { points.pop(); },
    (points) => { delete points[9]; },
    (points) => { points[17] = { ...points[5], x: points[5].x + 0.000001 }; },
  ];
  for (const invalidate of invalidPoints) {
    const hands = heartHands();
    invalidate(hands[0].landmarks);
    assert.equal(isHeartPose(hands), false);
  }
  assert.equal(isHeartPose([]), false);
});

test('empty frames cancel stability and reset clears both latch and cooldown', () => {
  const interpreter = new GestureInterpreter();
  const palms = [hand('Open_Palm')];
  interpreter.update(palms, 0);
  interpreter.update([], 100);
  interpreter.update(palms, 150);
  assert.equal(interpreter.update(palms, 329), null);
  assert.equal(interpreter.update(palms, 330), 'open-palm');
  interpreter.reset();
  assert.equal(interpreter.update(palms, 400), null);
  assert.equal(interpreter.update(palms, 580), 'open-palm');
});

test('non-finite and old timestamps do not corrupt a valid candidate', () => {
  const interpreter = new GestureInterpreter();
  const palms = [hand('Open_Palm')];
  interpreter.update(palms, 0);
  assert.equal(interpreter.update([], NaN), null);
  assert.equal(interpreter.update([], -1), null);
  assert.equal(interpreter.update(palms, 180), 'open-palm');
  assert.equal(interpreter.update([], 179), null);
  assert.equal(interpreter.update(palms, 1_500), null);
});

test('legacy composite-replay geometry preserves foreshortened heart poses', () => {
  for (const sample of referenceMotionSamples.slice(1)) {
    assert.equal(isHeartPose(sample.hands), true, `reference ${sample.timeMs}ms`);
  }
});

test('legacy open palms cannot become a heart despite low classification scores', () => {
  assert.equal(isHeartPose(referenceMotionSamples[0].hands), false);
});

test('legacy closing-motion geometry emits one heart event after the stable window', () => {
  const interpreter = new GestureInterpreter();
  const events = referenceMotionSamples.map(({ hands, timeMs }) => interpreter.update(hands, timeMs));
  assert.deepEqual(events, [null, null, null, 'heart']);
  const final = referenceMotionSamples.at(-1)!;
  assert.equal(interpreter.update(final.hands, final.timeMs + 1_000), null);
});


test('correctly cropped unfinished or unreliable poses do not satisfy heart geometry', () => {
  for (const { hands, sourceIndex } of correctedReferenceSamples) {
    assert.equal(isHeartPose(hands), false, `corrected source index ${sourceIndex}`);
  }
});

test('holding corrected negative frames cannot bypass heart geometry through time', () => {
  const interpreter = new GestureInterpreter();
  correctedReferenceSamples.forEach(({ hands }, index) => {
    assert.equal(interpreter.update(hands, index * 1_000), null);
    assert.equal(interpreter.update(hands, index * 1_000 + 600), null);
  });
});
