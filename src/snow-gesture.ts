import type { VisionHand } from './vision-types.js';

interface Point {
  x: number;
  y: number;
}

export interface SnowGestureFrame {
  active: boolean;
  /** Three-fingertip center in original, unmirrored image coordinates. */
  pointer: Point | null;
}

interface TrackedHand {
  handedness: VisionHand['handedness'];
  center: Point;
  scale: number;
  spread: number;
  outward: boolean;
  thumbIndexContact: boolean;
  pointer: Point;
}

const PINCH_ENTER = 0.25;
const PINCH_EXIT = 0.38;
const MIN_SCALE = 0.0001;
const INACTIVE: SnowGestureFrame = { active: false, pointer: null };

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
  const palmLength = distance(points[0], points[9]);
  const scale = Math.max(width, palmLength);
  if (width < MIN_SCALE || !Number.isFinite(scale) || scale < MIN_SCALE) return null;
  const palm = [0, 5, 9, 13, 17].map((index) => points[index]);
  const tips = [4, 8, 12].map((index) => points[index]);
  const tipCenter = {
    x: tips.reduce((sum, point) => sum + point.x, 0) / tips.length,
    y: tips.reduce((sum, point) => sum + point.y, 0) / tips.length,
  };
  // A fist can bring all tips together too. Require each finger to reach out,
  // and keep the joined tips outside the palm rather than folded toward the wrist.
  const indexAndThumbReach = !(source.gesture === 'Closed_Fist' && source.gestureScore >= 0.5)
    && distance(points[2], points[4]) >= scale * 0.22
    && distance(points[5], points[8]) >= scale * 0.28;
  const outward = indexAndThumbReach
    && distance(points[9], points[12]) >= scale * 0.28
    && distance(points[0], tipCenter) >= palmLength * 0.9;
  return {
    handedness: source.handedness,
    center: {
      x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
      y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
    },
    scale,
    spread: Math.max(distance(tips[0], tips[1]), distance(tips[0], tips[2]), distance(tips[1], tips[2])) / scale,
    outward,
    // This is a release lock, not a new-pinch classifier. A changed label or
    // folded posture must not imply that two touching fingertips separated.
    thumbIndexContact: distance(tips[0], tips[1]) / scale < PINCH_EXIT,
    pointer: {
      x: [4, 8, 12].reduce((sum, index) => sum + source.landmarks[index].x, 0) / 3,
      y: [4, 8, 12].reduce((sum, index) => sum + source.landmarks[index].y, 0) / 3,
    },
  };
}

/** Keeps a previous snow gesture from becoming a new decoration pinch on release. */
export function hasThumbIndexContact(hands: VisionHand[], imageAspect = 1): boolean {
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  return hands.some((hand) => trackedHand(hand, aspect)?.thumbIndexContact === true);
}

/** Immediate three-finger pinch with spatial hysteresis, without a lost-hand grace. */
export class SnowGestureTracker {
  private active: TrackedHand | null = null;
  private lastTimestamp = -Infinity;
  private lastAspect = 1;

  update(hands: VisionHand[], timestampMs: number, imageAspect = 1): SnowGestureFrame {
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= this.lastTimestamp) {
      this.active = null;
      return { ...INACTIVE };
    }
    const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
    if (timestampMs - this.lastTimestamp > 750 || aspect !== this.lastAspect) this.active = null;
    this.lastTimestamp = timestampMs;
    this.lastAspect = aspect;
    const tracked = hands.map((hand) => trackedHand(hand, aspect)).filter((hand): hand is TrackedHand => hand !== null);
    const previous = this.active;
    let selected: TrackedHand | null = null;
    if (previous) {
      const matches = tracked.filter((hand) =>
        previous.handedness === 'Unknown' || hand.handedness === 'Unknown'
          || previous.handedness === hand.handedness,
      );
      const nearest = matches.reduce<TrackedHand | null>((best, hand) =>
        !best || distance(hand.center, previous.center) < distance(best.center, previous.center) ? hand : best,
      null);
      if (nearest && distance(nearest.center, previous.center) <= Math.max(nearest.scale, previous.scale) * 1.4
        && Math.max(nearest.scale, previous.scale) / Math.min(nearest.scale, previous.scale) <= 2
        && nearest.outward && nearest.spread <= PINCH_EXIT) selected = nearest;
    }
    // A different hand must meet the entry threshold rather than inherit the latch.
    selected ??= tracked.find((hand) => hand.outward && hand.spread <= PINCH_ENTER) ?? null;
    this.active = selected;
    return selected ? { active: true, pointer: { ...selected.pointer } } : { ...INACTIVE };
  }

  reset(): void {
    this.active = null;
    this.lastTimestamp = -Infinity;
    this.lastAspect = 1;
  }
}
