const SIGNAL_TIMEOUT_MS = 750;
const EMISSION_RATE = 108;
const MAX_EMISSION_DELTA = 0.05;

export class InteractiveSnow {
  readonly positions: Float32Array;
  readonly opacities: Float32Array;
  readonly sizes: Float32Array;
  private readonly alive: Uint8Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly origins: Float32Array;
  private readonly speeds: Float32Array;
  private readonly drifts: Float32Array;
  private readonly sways: Float32Array;
  private readonly phases: Float32Array;
  private sourceX: number | null = null;
  private lastSignalMs = -Infinity;
  private emissionCredit = 0;
  private cursor = 0;
  private count = 0;
  private born = 0;

  constructor(readonly capacity = 576, private readonly random: () => number = Math.random) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Snow capacity must be a positive integer.');
    this.positions = new Float32Array(capacity * 3);
    this.opacities = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.ages = new Float32Array(capacity);
    this.lifetimes = new Float32Array(capacity);
    this.origins = new Float32Array(capacity);
    this.speeds = new Float32Array(capacity);
    this.drifts = new Float32Array(capacity);
    this.sways = new Float32Array(capacity);
    this.phases = new Float32Array(capacity);
  }

  get active(): boolean { return this.sourceX !== null; }
  get emitterX(): number | null { return this.sourceX; }
  get particleCount(): number { return this.count; }
  get spawnedCount(): number { return this.born; }

  setEmitter(screenX: number | null, nowMs: number): void {
    if (screenX === null || !Number.isFinite(screenX) || !Number.isFinite(nowMs)) {
      this.stop();
      return;
    }
    if (nowMs < this.lastSignalMs) return;
    if (this.sourceX === null) this.emissionCredit = 1;
    this.sourceX = Math.min(1, Math.max(0, screenX));
    this.lastSignalMs = nowMs;
  }

  stop(): void {
    this.sourceX = null;
    this.emissionCredit = 0;
  }

  clear(): void {
    this.stop();
    this.lastSignalMs = -Infinity;
    this.cursor = 0;
    this.count = 0;
    this.born = 0;
    this.alive.fill(0);
    this.positions.fill(0);
    this.opacities.fill(0);
    this.sizes.fill(0);
    this.ages.fill(0);
  }

  update(deltaSeconds: number, nowMs: number): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (!Number.isFinite(nowMs) || nowMs - this.lastSignalMs >= SIGNAL_TIMEOUT_MS) this.stop();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;

    for (let i = 0; i < this.capacity; ++i) {
      if (!this.alive[i]) continue;
      const age = this.ages[i] + delta;
      const y = -0.015 + age * this.speeds[i];
      if (age >= this.lifetimes[i] || y >= 1.08) {
        this.alive[i] = 0;
        this.opacities[i] = 0;
        --this.count;
        continue;
      }
      this.ages[i] = age;
      this.positions[i * 3] = this.origins[i] + this.drifts[i] * age
        + (Math.sin(age * 1.8 + this.phases[i]) - Math.sin(this.phases[i])) * this.sways[i];
      this.positions[i * 3 + 1] = y;
      const fadeIn = Math.min(1, age / 0.15);
      const fadeOut = Math.min(1, Math.max(0, (this.lifetimes[i] - age) / 0.7));
      const bottomFade = Math.min(1, Math.max(0, (1.05 - y) / 0.15));
      this.opacities[i] = fadeIn * fadeOut * bottomFade * 0.95;
    }

    if (this.sourceX === null) return;
    // Discard elapsed missed-frame time rather than building a spawn backlog.
    if (delta > 0.25) this.emissionCredit = 0;
    this.emissionCredit += Math.min(delta, MAX_EMISSION_DELTA) * EMISSION_RATE;
    const due = Math.floor(this.emissionCredit);
    this.emissionCredit -= due;
    for (let i = 0; i < due; ++i) this.spawn(this.sourceX);
  }

  private spawn(x: number): void {
    if (this.count >= this.capacity) return;
    let slot = this.cursor;
    for (let checked = 0; checked < this.capacity && this.alive[slot]; ++checked) slot = (slot + 1) % this.capacity;
    this.cursor = (slot + 1) % this.capacity;
    this.alive[slot] = 1;
    this.ages[slot] = 0;
    this.origins[slot] = x;
    this.positions[slot * 3] = x;
    this.positions[slot * 3 + 1] = -0.015;
    this.positions[slot * 3 + 2] = 0;
    this.opacities[slot] = 0;
    this.sizes[slot] = 8 + this.random() * 5;
    this.lifetimes[slot] = 4 + this.random() * 1.2;
    this.speeds[slot] = 0.24 + this.random() * 0.1;
    this.drifts[slot] = (this.random() - 0.5) * 0.008;
    this.sways[slot] = 0.004 + this.random() * 0.01;
    this.phases[slot] = this.random() * Math.PI * 2;
    ++this.count;
    ++this.born;
  }
}
