import type { VisionHand } from './vision-types.js';

export interface ContinuousGestureFrame {
  pointing: boolean;
  pinching: boolean;
  pinchStarted: boolean;
  /** Newly observed travel, normalized by palm size; always non-negative. */
  movementDelta: number;
  /** Selected fingertip in original, unmirrored image coordinates. */
  pointer: Point | null;
}

interface Point {
  x: number;
  y: number;
}

interface TrackedHand {
  source: VisionHand;
  points: Point[];
  center: Point;
  scale: number;
}

interface ActiveHand {
  handedness: VisionHand['handedness'];
  center: Point;
  scale: number;
}

const EMPTY_FRAME: ContinuousGestureFrame = {
  pointing: false,
  pinching: false,
  pinchStarted: false,
  movementDelta: 0,
  pointer: null,
};

const MIN_SCALE = 0.0001;
const PINCH_ENTER = 0.25;
const PINCH_EXIT = 0.38;
const MOVEMENT_DEADBAND = 0.04;
const MIN_PIXEL_DEADBAND = 4;
const MAX_FRAME_MOVEMENT = 1.2;
const POSE_GRACE_MS = 600;
export const POINTING_CONFIDENCE = 0.3;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function trackedHand(source: VisionHand, aspect: number): TrackedHand | null {
  if (!Array.isArray(source?.landmarks) || source.landmarks.length !== 21) return null;
  const points: Point[] = [];
  for (const point of source.landmarks) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null;
    points.push({ x: point.x * aspect, y: point.y });
  }
  const width = distance(points[5], points[17]);
  const scale = Math.max(width, distance(points[0], points[9]));
  if (width < MIN_SCALE || !Number.isFinite(scale) || scale < MIN_SCALE) return null;
  const palm = [0, 5, 9, 13, 17].map((index) => points[index]);
  return {
    source,
    points,
    scale,
    center: {
      x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
      y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
    },
  };
}

function fingerReachRatio(hand: TrackedHand, base: number): number {
  const p = hand.points;
  const path = distance(p[base], p[base + 1]) + distance(p[base + 1], p[base + 2]) + distance(p[base + 2], p[base + 3]);
  return path > MIN_SCALE ? distance(p[base], p[base + 3]) / path : 0;
}

function explicitlyReleased(hand: TrackedHand): boolean {
  return (hand.source.gesture === 'Open_Palm' || hand.source.gesture === 'Closed_Fist')
    && hand.source.gestureScore >= 0.55;
}

function pointingGeometry(hand: TrackedHand, relaxed = false): boolean {
  const { points: p, scale } = hand;
  const uprightIndex = fingerReachRatio(hand, 5) >= (relaxed ? 0.7 : 0.85)
    && p[5].y - p[8].y >= scale * (relaxed ? 0.15 : 0.35);
  const curledCount = [9, 13, 17].filter((base) =>
    fingerReachRatio(hand, base) <= (relaxed ? 0.92 : 0.85)
      || distance(p[base], p[base + 3]) <= scale * (relaxed ? 0.85 : 0.65),
  ).length;
  return uprightIndex && curledCount >= (relaxed ? 2 : 3);
}

function isPointing(hand: TrackedHand): boolean {
  if (explicitlyReleased(hand)) return false;
  const { source } = hand;
  return (source.gesture === 'Pointing_Up' && Number.isFinite(source.gestureScore)
    && source.gestureScore >= POINTING_CONFIDENCE) || pointingGeometry(hand);
}

function canPinch(hand: TrackedHand): boolean {
  const { source, points: p, scale } = hand;
  if (source.gesture === 'Closed_Fist' && source.gestureScore >= 0.5) return false;
  // A folded fist can also put 4 and 8 together; require both fingers to reach outward.
  return distance(p[5], p[8]) >= scale * 0.28 && distance(p[2], p[4]) >= scale * 0.22;
}

function pinchRatio(hand: TrackedHand): number {
  return distance(hand.points[4], hand.points[8]) / hand.scale;
}

function isKnownHand(value: VisionHand['handedness']): boolean {
  return value === 'Left' || value === 'Right';
}

export class ContinuousGestureTracker {
  private active: ActiveHand | null = null;
  private lastTimestamp = -Infinity;
  private lastAspect = 1;
  private pinching = false;
  private motionAnchor: Point | null = null;
  private previousPoint: Point | null = null;
  private previousScale = 0;
  private pointing = false;
  private lastPointingAt = -Infinity;

  update(hands: VisionHand[], timestampMs: number, imageAspect = 1, imageHeight = 480): ContinuousGestureFrame {
    const wasRecognized = this.pointing && this.lastPointingAt === this.lastTimestamp;
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= this.lastTimestamp) {
      this.pointing = false;
      this.lastPointingAt = -Infinity;
      this.clearMotion();
      return { ...EMPTY_FRAME };
    }
    const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
    if (timestampMs - this.lastTimestamp > 750) {
      this.clearMotion();
      this.pointing = false;
      this.lastPointingAt = -Infinity;
    }
    if (aspect !== this.lastAspect) {
      this.active = null;
      this.pinching = false;
      this.pointing = false;
      this.lastPointingAt = -Infinity;
      this.clearMotion();
    }
    this.lastTimestamp = timestampMs;
    this.lastAspect = aspect;

    const tracked = hands.map((hand) => trackedHand(hand, aspect)).filter((hand): hand is TrackedHand => hand !== null);
    const { hand, changed } = this.selectHand(tracked);
    if (!hand) {
      this.active = null;
      this.pinching = false;
      this.pointing = false;
      this.lastPointingAt = -Infinity;
      this.clearMotion();
      return { ...EMPTY_FRAME };
    }
    if (changed) {
      this.pinching = false;
      this.pointing = false;
      this.lastPointingAt = -Infinity;
      this.clearMotion();
    }
    this.active = { handedness: hand.source.handedness, center: hand.center, scale: hand.scale };

    const ratio = pinchRatio(hand);
    const nextPinching = canPinch(hand) && (this.pinching ? ratio < PINCH_EXIT : ratio <= PINCH_ENTER);
    const pinchStarted = nextPinching && !this.pinching;
    if (nextPinching !== this.pinching) this.clearMotion();
    this.pinching = nextPinching;
    if (nextPinching) {
      this.pointing = false;
      this.lastPointingAt = -Infinity;
      this.clearMotion();
      return { ...EMPTY_FRAME, pinching: true, pinchStarted };
    }
    const recognized = isPointing(hand);
    // Entering/leaving pose grace can move the fingertip just by bending it.
    // Reanchor that transition; subsequent observed motion still works in grace.
    if (this.pointing && recognized !== wasRecognized) this.clearMotion();
    if (recognized) this.lastPointingAt = timestampMs;
    const held = this.pointing && timestampMs - this.lastPointingAt <= POSE_GRACE_MS
      && !explicitlyReleased(hand) && pointingGeometry(hand, true);
    this.pointing = recognized || held;
    if (!this.pointing) {
      this.lastPointingAt = -Infinity;
      this.clearMotion();
      return { ...EMPTY_FRAME };
    }
    return {
      pointing: true,
      pinching: false,
      pinchStarted: false,
      movementDelta: this.trackMovement(hand.points[8], hand.scale,
        MIN_PIXEL_DEADBAND / (Number.isFinite(imageHeight) && imageHeight > 0 ? imageHeight : 480)),
      pointer: { x: hand.source.landmarks[8].x, y: hand.source.landmarks[8].y },
    };
  }

  reset(): void {
    this.active = null;
    this.lastTimestamp = -Infinity;
    this.lastAspect = 1;
    this.pinching = false;
    this.pointing = false;
    this.lastPointingAt = -Infinity;
    this.clearMotion();
  }

  private selectHand(hands: TrackedHand[]): { hand: TrackedHand | null; changed: boolean } {
    const enteringPinch = hands.find((hand) => canPinch(hand) && pinchRatio(hand) <= PINCH_ENTER);
    if (this.active) {
      const active = this.active;
      const matches = hands.filter((hand) =>
        !isKnownHand(active.handedness) || !isKnownHand(hand.source.handedness) || active.handedness === hand.source.handedness,
      );
      const closest = matches.reduce<TrackedHand | null>((best, hand) =>
        !best || distance(hand.center, active.center) < distance(best.center, active.center) ? hand : best,
      null);
      if (closest && distance(closest.center, active.center) <= Math.max(closest.scale, active.scale) * 1.4
        && Math.max(closest.scale, active.scale) / Math.min(closest.scale, active.scale) <= 2) {
        const ratio = pinchRatio(closest);
        const activePinch = canPinch(closest) && (this.pinching ? ratio < PINCH_EXIT : ratio <= PINCH_ENTER);
        if (enteringPinch && enteringPinch !== closest && !activePinch) {
          return { hand: enteringPinch, changed: true };
        }
        return { hand: closest, changed: false };
      }
    }
    const hand = enteringPinch ?? hands.find(isPointing);
    return { hand: hand ?? null, changed: true };
  }

  private clearMotion(): void {
    this.motionAnchor = null;
    this.previousPoint = null;
    this.previousScale = 0;
  }

  private trackMovement(point: Point, scale: number, pixelDeadband: number): number {
    const previous = this.previousPoint;
    const normalizedScale = this.previousScale > 0 ? (scale + this.previousScale) / 2 : scale;
    this.previousPoint = point;
    this.previousScale = scale;
    if (!previous || !this.motionAnchor || distance(point, previous) > normalizedScale * MAX_FRAME_MOVEMENT) {
      this.motionAnchor = point;
      return 0;
    }
    // A stationary input never drains a queue or an interpolation tail.
    if (distance(point, previous) < 1e-9) return 0;
    const length = distance(point, this.motionAnchor);
    const travel = length - Math.max(normalizedScale * MOVEMENT_DEADBAND, pixelDeadband);
    if (travel <= 1e-9) return 0;

    // Spatial slack filters jitter yet lets slow motion accumulate. Move the
    // anchor only by observed travel beyond the slack, without a time window.
    const fraction = travel / length;
    this.motionAnchor = {
      x: this.motionAnchor.x + (point.x - this.motionAnchor.x) * fraction,
      y: this.motionAnchor.y + (point.y - this.motionAnchor.y) * fraction,
    };
    return travel / normalizedScale;
  }
}
