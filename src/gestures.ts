import type { VisionHand } from './vision-types.js';

export type GestureEvent = 'open-palm' | 'pointing-up' | 'two-palms' | 'heart';

type Point = VisionHand['landmarks'][number];

const CONFIDENCE = 0.55;
const COOLDOWN_MS = 1_000;
const MIN_PALM_SCALE = 0.0001;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function palmScale(hand: VisionHand): number {
  // Inward-turned palms foreshorten the MCP width; the wrist-to-MCP length stays usable.
  return Math.max(
    distance(hand.landmarks[5], hand.landmarks[17]),
    distance(hand.landmarks[0], hand.landmarks[9]),
  );
}

function isTrackedHand(hand: VisionHand): boolean {
  const points = hand?.landmarks;
  if (!Array.isArray(points) || points.length !== 21) return false;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      return false;
    }
  }
  return distance(points[5], points[17]) >= MIN_PALM_SCALE;
}

function matches(hand: VisionHand, gesture: string): boolean {
  return hand.gesture === gesture && Number.isFinite(hand.gestureScore) && hand.gestureScore >= CONFIDENCE;
}

function hasCurvedIndex(hand: VisionHand): boolean {
  const points = hand.landmarks;
  const path = distance(points[5], points[6]) + distance(points[6], points[7]) + distance(points[7], points[8]);
  return path > MIN_PALM_SCALE && distance(points[5], points[8]) / path <= 0.97;
}

/** Detects a front-facing two-hand heart; it is not the single-hand ILoveYou sign. */
export function isHeartPose(hands: readonly VisionHand[]): boolean {
  if (hands.length !== 2 || !hands.every(isTrackedHand)) return false;
  if (hands.every((hand) => matches(hand, 'Open_Palm')) || hands.every((hand) => matches(hand, 'Pointing_Up'))) {
    return false;
  }

  const [first, second] = hands;
  const firstScale = palmScale(first);
  const secondScale = palmScale(second);
  if (Math.max(firstScale, secondScale) / Math.min(firstScale, secondScale) > 2.2) return false;
  const scale = (firstScale + secondScale) / 2;
  const firstPalm = midpoint(first.landmarks[5], first.landmarks[17]);
  const secondPalm = midpoint(second.landmarks[5], second.landmarks[17]);
  const [leftPalm, rightPalm] = firstPalm.x <= secondPalm.x
    ? [firstPalm, secondPalm]
    : [secondPalm, firstPalm];
  const thumbTop = midpoint(first.landmarks[4], second.landmarks[4]);
  const indexTop = midpoint(first.landmarks[8], second.landmarks[8]);

  // Both fingertip pairs meet, while the palms remain on opposite sides.
  if (distance(first.landmarks[4], second.landmarks[4]) / scale > 0.55) return false;
  if (distance(first.landmarks[8], second.landmarks[8]) / scale > 0.55) return false;
  const palmSeparation = (rightPalm.x - leftPalm.x) / scale;
  if (palmSeparation < 1.1 || palmSeparation > 4.5) return false;
  if (Math.abs(leftPalm.y - rightPalm.y) / scale > 1.2) return false;

  // The index fingers form the upper join and the thumbs the lower join.
  const opening = (thumbTop.y - indexTop.y) / scale;
  if (opening < 0.45 || opening > 2.6) return false;
  if (Math.abs(indexTop.x - thumbTop.x) / scale > 0.65) return false;
  for (const join of [indexTop, thumbTop]) {
    if ((join.x - leftPalm.x) / scale < 0.35 || (rightPalm.x - join.x) / scale < 0.35) return false;
  }

  for (const hand of hands) {
    const aperture = distance(hand.landmarks[4], hand.landmarks[8]) / palmScale(hand);
    if (aperture < 0.55 || aperture > 2.8 || !hasCurvedIndex(hand)) return false;
  }
  return true;
}

function candidateGesture(hands: readonly VisionHand[]): GestureEvent | null {
  const tracked = hands.filter(isTrackedHand);
  if (isHeartPose(tracked)) return 'heart';
  if (tracked.length === 2 && tracked.every((hand) => matches(hand, 'Open_Palm'))) return 'two-palms';
  if (tracked.some((hand) => matches(hand, 'Pointing_Up'))) return 'pointing-up';
  if (tracked.some((hand) => matches(hand, 'Open_Palm'))) return 'open-palm';
  return null;
}

export class GestureInterpreter {
  private candidate: GestureEvent | null = null;
  private candidateSince = 0;
  private emitted = false;
  private lastEventAt = -Infinity;
  private lastTimestamp = -Infinity;

  update(hands: VisionHand[], timestampMs: number): GestureEvent | null {
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs < this.lastTimestamp) return null;
    this.lastTimestamp = timestampMs;
    const candidate = candidateGesture(hands);
    if (candidate !== this.candidate) {
      this.candidate = candidate;
      this.candidateSince = timestampMs;
      this.emitted = false;
    }
    if (!candidate || this.emitted) return null;
    const stableMs = candidate === 'heart' ? 300 : 180;
    if (timestampMs - this.candidateSince < stableMs || timestampMs - this.lastEventAt < COOLDOWN_MS) {
      return null;
    }

    // Only latch a candidate when an event is actually emitted, including after cooldown.
    this.emitted = true;
    this.lastEventAt = timestampMs;
    return candidate;
  }

  reset(): void {
    this.candidate = null;
    this.candidateSince = 0;
    this.emitted = false;
    this.lastEventAt = -Infinity;
    this.lastTimestamp = -Infinity;
  }
}
