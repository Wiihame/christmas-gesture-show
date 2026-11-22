import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContinuousGestureTracker } from '../src/continuous-gestures.js';
import type { VisionHand } from '../src/vision-types.js';

function pointingHand(x = 0.46, y = 0.24, handedness: VisionHand['handedness'] = 'Left'): VisionHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.75, z: 0 };
  landmarks[1] = { x: 0.4, y: 0.65, z: 0 };
  landmarks[2] = { x: 0.35, y: 0.6, z: 0 };
  landmarks[3] = { x: 0.32, y: 0.57, z: 0 };
  landmarks[4] = { x: 0.3, y: 0.54, z: 0 };
  landmarks[5] = { x: 0.44, y: 0.52, z: 0 };
  landmarks[6] = { x: 0.44 + (x - 0.44) * 0.4, y: 0.52 + (y - 0.52) * 0.4, z: 0 };
  landmarks[7] = { x: 0.44 + (x - 0.44) * 0.7, y: 0.52 + (y - 0.52) * 0.7, z: 0 };
  landmarks[8] = { x, y, z: 0 };
  for (const [base, baseX, baseY] of [[9, 0.49, 0.50], [13, 0.53, 0.51], [17, 0.57, 0.52]]) {
    landmarks[base] = { x: baseX, y: baseY, z: 0 };
    landmarks[base + 1] = { x: baseX + 0.01, y: baseY - 0.06, z: 0 };
    landmarks[base + 2] = { x: baseX + 0.015, y: baseY, z: 0 };
    landmarks[base + 3] = { x: baseX, y: baseY + 0.04, z: 0 };
  }
  return { landmarks, handedness, score: 0.99, gesture: 'Pointing_Up', gestureScore: 0.95 };
}

function scale(hand: VisionHand, aspect = 1): number {
  const distance = (a: number, b: number) => Math.hypot((hand.landmarks[a].x - hand.landmarks[b].x) * aspect, hand.landmarks[a].y - hand.landmarks[b].y);
  return Math.max(distance(5, 17), distance(0, 9));
}

function pinchHand(ratio: number): VisionHand {
  const hand = pointingHand();
  hand.landmarks[4] = { ...hand.landmarks[8], x: hand.landmarks[8].x + scale(hand) * ratio };
  return hand;
}

function moveHand(hand: VisionHand, dx: number): VisionHand {
  return { ...hand, landmarks: hand.landmarks.map((point) => ({ ...point, x: point.x + dx })) };
}

function trajectory(points: Array<[number, number]>, interval = 30, transform = (hand: VisionHand) => hand, aspect = 1): number {
  const tracker = new ContinuousGestureTracker();
  return points.reduce((total, [x, y], index) =>
    total + tracker.update([transform(pointingHand(x, y))], index * interval, aspect).movementDelta, 0);
}

function circlePoints(count = 120, ry = 0.08, drift = 0): Array<[number, number]> {
  return Array.from({ length: count + 1 }, (_, i) => [
    0.46 + Math.cos(i * 2 * Math.PI / count) * 0.08 + drift * i / count,
    0.24 + Math.sin(i * 2 * Math.PI / count) * ry,
  ]);
}

const empty = { pointing: false, pinching: false, pinchStarted: false, movementDelta: 0, pointer: null };
const totalScale = scale(pointingHand());

test('the first deliberate straight displacement advances without waiting for an arc', () => {
  const tracker = new ContinuousGestureTracker();
  const first = tracker.update([pointingHand()], 0);
  assert.equal(first.movementDelta, 0);
  assert.deepEqual(first.pointer, { x: 0.46, y: 0.24 });
  const moved = tracker.update([pointingHand(0.49)], 30);
  assert.ok(moved.movementDelta > 0.07);
  assert.deepEqual(moved.pointer, { x: 0.49, y: 0.24 });
});

test('circles, flattened ellipses and drifting centers all count observed travel', () => {
  for (const ry of [0.08, 0.02]) {
    for (const drift of [0, 0.12]) {
      const points = circlePoints(120, ry, drift);
      const observed = trajectory(points);
      const perimeter = points.slice(1).reduce((sum, point, i) =>
        sum + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]), 0) / totalScale;
      assert.ok(observed > perimeter * 0.8 && observed <= perimeter, `${ry}/${drift}: ${observed}/${perimeter}`);
      const reverse = trajectory([...points].reverse());
      assert.ok(Math.abs(observed - reverse) < 0.08, 'Both directions advance');
    }
  }
});

test('lines, sharp corners and back-and-forth movement are accepted', () => {
  const line: Array<[number, number]> = Array.from({ length: 31 }, (_, i) => [0.4 + i * 0.005, 0.24]);
  const outward = trajectory(line);
  assert.ok(Math.abs(outward - (0.15 / totalScale - 0.04)) < 1e-10);
  assert.ok(trajectory([...line, ...line.slice().reverse()]) > outward * 1.8);
  assert.ok(trajectory([[0.4, 0.24], [0.55, 0.24], [0.55, 0.35], [0.4, 0.35], [0.4, 0.24]]) > 1.7);
});

test('palm-size normalization and aspect correction preserve travel within pixel-filter tolerance', () => {
  const points = circlePoints();
  const baseline = trajectory(points);
  for (const factor of [0.5, 1.5]) {
    const total = trajectory(points, 30, (hand) => ({
      ...hand, landmarks: hand.landmarks.map((p) => ({ x: p.x * factor, y: p.y * factor, z: p.z * factor })),
    }));
    assert.ok(Math.abs(total - baseline) / baseline < 0.04, 'The pixel noise floor may remove slightly more travel from smaller hands');
  }
  const wideImage = trajectory(points, 30, (hand) => ({
    ...hand, landmarks: hand.landmarks.map((p) => ({ ...p, x: p.x / 2 })),
  }), 2);
  assert.ok(Math.abs(wideImage - baseline) < 1e-10);
});

test('slow motion accumulates beyond spatial slack instead of failing a per-frame speed threshold', () => {
  const tracker = new ContinuousGestureTracker();
  let travel = 0;
  for (let i = 0; i <= 200; ++i) travel += tracker.update([pointingHand(0.46 + i * 0.0002)], i * 50).movementDelta;
  assert.ok(Math.abs(travel - (0.04 / totalScale - 0.04)) < 1e-10);
});

test('progress follows distance, independent of timestamps or sample count on a straight path', () => {
  const path = (steps: number, length: number): Array<[number, number]> =>
    Array.from({ length: steps + 1 }, (_, i) => [0.4 + length * i / steps, 0.24]);
  const baseline = trajectory(path(40, 0.16));
  assert.ok(Math.abs(trajectory(path(40, 0.16), 330) - baseline) < 1e-10);
  assert.ok(Math.abs(trajectory(path(8, 0.16)) - baseline) < 1e-10);
  assert.ok(trajectory(path(40, 0.3)) > baseline * 1.8);
});

test('normal CPU inference intervals and coarse paths still advance', () => {
  const points = circlePoints(9, 0.02, 0.1);
  assert.ok(trajectory(points, 330) > 0.8);
  assert.equal(trajectory(points, 330), trajectory(points, 30));
});

test('fixed fingertips and micro jitter do not advance', () => {
  const fixed = new ContinuousGestureTracker();
  const jitter = new ContinuousGestureTracker();
  for (let index = 0; index < 300; ++index) {
    assert.equal(fixed.update([pointingHand()], index * 30).movementDelta, 0);
    const noise = (index % 2 ? 1 : -1) * 0.001;
    assert.equal(jitter.update([pointingHand(0.46 + noise, 0.24 - noise)], index * 30).movementDelta, 0);
  }
});

test('stopping yields zero immediately and prolonged bounded noise does not keep growing', () => {
  const tracker = new ContinuousGestureTracker();
  tracker.update([pointingHand(0.4)], 0);
  assert.ok(tracker.update([pointingHand(0.55)], 30).movementDelta > 0);
  for (let i = 2; i <= 20; ++i) assert.equal(tracker.update([pointingHand(0.55)], i * 30).movementDelta, 0);
  let seed = 42;
  let stoppedTravel = 0;
  let lateTravel = 0;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 0.008;
  };
  for (let i = 21; i <= 2_020; ++i) {
    const delta = tracker.update([pointingHand(0.55 + noise(), 0.24 + noise())], i * 30).movementDelta;
    stoppedTravel += delta;
    if (i > 1_020) lateTravel += delta;
  }
  assert.ok(stoppedTravel < 0.04, `Noise travel ${stoppedTravel}`);
  assert.ok(lateTravel < 0.001, `Prolonged noise travel ${lateTravel}`);
});

test('missing hands and long gaps reanchor without catch-up, then accept new movement', () => {
  for (const missing of [true, false]) {
    const tracker = new ContinuousGestureTracker();
    tracker.update([pointingHand(0.4)], 0);
    tracker.update([pointingHand(0.5)], 30);
    if (missing) assert.deepEqual(tracker.update([], 60), empty);
    const resumeAt = missing ? 90 : 1_030;
    assert.equal(tracker.update([pointingHand(0.7)], resumeAt).movementDelta, 0);
    assert.ok(tracker.update([pointingHand(0.73)], resumeAt + 30).movementDelta > 0);
  }
});

test('result reorder keeps the selected pointer for known and unknown handedness', () => {
  for (const known of [true, false]) {
    const tracker = new ContinuousGestureTracker();
    let total = 0;
    circlePoints().forEach(([x, y], i) => {
      const active = pointingHand(x, y, known ? 'Left' : 'Unknown');
      const other = moveHand(pointingHand(0.46, 0.24, known ? 'Right' : 'Unknown'), 0.4);
      const result = tracker.update(i % 2 ? [other, active] : [active, other], i * 30);
      total += result.movementDelta;
      assert.deepEqual(result.pointer, { x, y });
    });
    assert.ok(Math.abs(total - trajectory(circlePoints())) < 1e-10);
  }
});

test('a different hand cannot inherit previous travel', () => {
  const tracker = new ContinuousGestureTracker();
  tracker.update([pointingHand(0.4)], 0);
  tracker.update([pointingHand(0.5)], 30);
  assert.equal(tracker.update([pointingHand(0.6, 0.24, 'Right')], 60).movementDelta, 0);
});

test('pinch hysteresis fires once, hides the cursor and outranks pointing', () => {
  const tracker = new ContinuousGestureTracker();
  assert.equal(tracker.update([pinchHand(0.3)], 0).pinching, false);
  assert.deepEqual(tracker.update([pinchHand(0.2)], 30), { ...empty, pinching: true, pinchStarted: true });
  assert.deepEqual(tracker.update([pinchHand(0.3)], 60), { ...empty, pinching: true });
  assert.equal(tracker.update([pinchHand(0.37)], 90).pinching, true);
  const released = tracker.update([pinchHand(0.4)], 120);
  assert.equal(released.pinching, false);
  assert.equal(released.movementDelta, 0);
  assert.equal(tracker.update([pinchHand(0.2)], 150).pinchStarted, true);
});

test('pinching another hand preempts pointing regardless of result order', () => {
  const other = moveHand(pinchHand(0.2), 0.35);
  other.handedness = 'Right';
  for (const reverse of [true, false]) {
    const tracker = new ContinuousGestureTracker();
    tracker.update([pointingHand()], 0);
    const hands = reverse ? [other, pointingHand()] : [pointingHand(), other];
    assert.deepEqual(tracker.update(hands, 30), { ...empty, pinching: true, pinchStarted: true });
    assert.equal(tracker.update([...hands].reverse(), 60).pinchStarted, false);
    assert.equal(new ContinuousGestureTracker().update(hands, 0).pinchStarted, true);
  }
});

test('a folded fist with touching fingertips is not a pinch', () => {
  for (const gesture of ['Closed_Fist', 'None']) {
    const fist = pointingHand();
    fist.gesture = gesture;
    fist.landmarks[8] = { ...fist.landmarks[5], y: fist.landmarks[5].y + 0.01 };
    fist.landmarks[4] = { ...fist.landmarks[8], x: fist.landmarks[8].x + 0.005 };
    assert.deepEqual(new ContinuousGestureTracker().update([fist], 0), empty);
  }
});

test('a bent OK-shaped index still supports thumb-index pinching', () => {
  const hand = pointingHand();
  hand.gesture = 'None';
  hand.landmarks[6] = { x: 0.44, y: 0.42, z: 0 };
  hand.landmarks[7] = { x: 0.5, y: 0.4, z: 0 };
  hand.landmarks[8] = { x: 0.52, y: 0.48, z: 0 };
  hand.landmarks[4] = { x: 0.512, y: 0.48, z: 0 };
  assert.deepEqual(new ContinuousGestureTracker().update([hand], 0), { ...empty, pinching: true, pinchStarted: true });
});

test('geometry can enter pointing when model classification is uncertain', () => {
  const hand = pointingHand();
  hand.gesture = 'None';
  hand.gestureScore = 0.1;
  assert.equal(new ContinuousGestureTracker().update([hand], 0).pointing, true);
  hand.landmarks[8].y = 0.6;
  assert.deepEqual(new ContinuousGestureTracker().update([hand], 0), empty);
});

test('uncertain but plausible posture has a bounded grace period, never an automatic animation', () => {
  const tracker = new ContinuousGestureTracker();
  tracker.update([pointingHand()], 0);
  const uncertain = pointingHand(0.46, 0.46);
  uncertain.gesture = 'None';
  assert.equal(new ContinuousGestureTracker().update([uncertain], 0).pointing, false, 'Grace cannot open the gate');
  const held = tracker.update([uncertain], 200);
  assert.equal(held.pointing, true);
  assert.equal(held.movementDelta, 0, 'Entering uncertain posture must not count the folding transition');
  const still = tracker.update([uncertain], 400);
  assert.equal(still.pointing, true);
  assert.equal(still.movementDelta, 0);
  assert.deepEqual(tracker.update([uncertain], 610), empty);
  assert.equal(tracker.update([pointingHand()], 640).movementDelta, 0);
});

test('explicit fist, open palm, and collapsed index release immediately despite grace', () => {
  for (const gesture of ['Closed_Fist', 'Open_Palm', 'None']) {
    const tracker = new ContinuousGestureTracker();
    tracker.update([pointingHand()], 0);
    const released = pointingHand();
    released.gesture = gesture;
    if (gesture === 'None') released.landmarks[8].y = 0.53;
    assert.deepEqual(tracker.update([released], 30), empty);
    assert.equal(tracker.update([pointingHand(0.6)], 60).movementDelta, 0);
  }
});

test('lower pointing confidence remains accepted without widening the threshold again', () => {
  const hand = pointingHand();
  hand.landmarks[8].y = 0.6; // Disable geometry fallback to isolate classification.
  hand.gestureScore = 0.32;
  assert.equal(new ContinuousGestureTracker().update([hand], 0).pointing, true);
  hand.gestureScore = 0.29;
  assert.equal(new ContinuousGestureTracker().update([hand], 0).pointing, false);
});

test('abrupt endpoint jumps are rejected and following movement uses the new anchor', () => {
  const tracker = new ContinuousGestureTracker();
  tracker.update([pointingHand(0.4)], 0);
  assert.equal(tracker.update([pointingHand(0.85)], 30).movementDelta, 0);
  const next = tracker.update([pointingHand(0.88)], 60).movementDelta;
  assert.ok(next > 0 && next < 0.1);
});

test('invalid and degenerate landmarks never produce controls', () => {
  const cases = [pointingHand(), pointingHand(), pointingHand(), pointingHand()];
  cases[0].landmarks[8].x = NaN;
  cases[1].landmarks.pop();
  delete cases[2].landmarks[9];
  cases[3].landmarks[17] = { ...cases[3].landmarks[5] };
  for (const hand of cases) assert.deepEqual(new ContinuousGestureTracker().update([hand], 0), empty);
});

test('invalid or duplicate timestamps and aspect changes never bridge earlier travel', () => {
  for (const invalid of [NaN, Infinity, -1, 30, 20]) {
    const tracker = new ContinuousGestureTracker();
    tracker.update([pointingHand(0.4)], 30);
    assert.deepEqual(tracker.update([pointingHand(0.6)], invalid), empty);
    assert.equal(tracker.update([pointingHand(0.7)], 60).movementDelta, 0);
  }
  const tracker = new ContinuousGestureTracker();
  tracker.update([pointingHand(0.4)], 0);
  assert.equal(tracker.update([pointingHand(0.6)], 30, 2).movementDelta, 0);
});

test('reset clears pinch and movement history even when timestamps restart', () => {
  const tracker = new ContinuousGestureTracker();
  assert.equal(tracker.update([pinchHand(0.2)], 0).pinchStarted, true);
  tracker.reset();
  assert.equal(tracker.update([pinchHand(0.2)], 0).pinchStarted, true);
  tracker.update([pointingHand(0.4)], 30);
  tracker.update([pointingHand(0.5)], 60);
  tracker.reset();
  assert.equal(tracker.update([pointingHand(0.6)], 0).movementDelta, 0);
});


test('small hands do not accumulate stationary pixel noise indefinitely', () => {
  for (const factor of [0.3, 0.4, 0.5]) {
    const tracker = new ContinuousGestureTracker();
    let seed = 42;
    let tail = 0;
    const noise = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 2 ** 32 - 0.5) * 0.008;
    };
    for (let i = 0; i < 2_000; ++i) {
      const hand = pointingHand();
      hand.landmarks = hand.landmarks.map((p) => ({ ...p, x: p.x * factor, y: p.y * factor }));
      hand.landmarks[8].x += noise();
      hand.landmarks[8].y += noise();
      const delta = tracker.update([hand], i * 30).movementDelta;
      if (i >= 1_000) tail += delta;
    }
    assert.ok(tail < 0.001, `Scale ${factor}: ongoing stationary travel ${tail}`);
  }
});

test('recovering a confident pose from grace reanchors before accepting new travel', () => {
  const tracker = new ContinuousGestureTracker();
  tracker.update([pointingHand()], 0);
  const uncertain = pointingHand(0.46, 0.46);
  uncertain.gesture = 'None';
  tracker.update([uncertain], 200);
  const moving = pointingHand(0.49, 0.46);
  moving.gesture = 'None';
  assert.ok(tracker.update([moving], 300).movementDelta > 0, 'Grace still accepts deliberate movement');
  assert.equal(tracker.update([pointingHand(0.49)], 400).movementDelta, 0, 'Straightening the finger is not catch-up travel');
  assert.ok(tracker.update([pointingHand(0.52)], 430).movementDelta > 0);
});


test('pixel noise floor adapts to the input resolution', () => {
  for (const height of [480, 960]) {
    const tracker = new ContinuousGestureTracker();
    const small = pointingHand();
    small.landmarks = small.landmarks.map((p) => ({ ...p, x: p.x * 0.3, y: p.y * 0.3 }));
    assert.equal(tracker.update([small], 0, 1, height).movementDelta, 0);
    const jitter = structuredClone(small);
    jitter.landmarks[8].x += 3 / height;
    assert.equal(tracker.update([jitter], 30, 1, height).movementDelta, 0);
    const motion = structuredClone(small);
    motion.landmarks[8].x += 8 / height;
    assert.ok(tracker.update([motion], 60, 1, height).movementDelta > 0);
  }
});
