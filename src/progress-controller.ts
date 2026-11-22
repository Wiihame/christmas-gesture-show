import type { ContinuousGestureFrame } from './continuous-gestures.js';

export type ProgressMode = 'growth' | 'decoration';
export interface ProgressState {
  mode: ProgressMode;
  growth: number;
  decoration: number;
}

interface ProgressScene {
  startInteraction(): void;
  setGrowthProgress(progress: number): void;
  setDecorationProgress(progress: number): void;
}

/** Progress is driven only by observed fingertip travel, never by elapsed time. */
export class MovementProgressController {
  private mode: ProgressMode = 'growth';
  private growth = 0;
  private decoration = 0;

  constructor(private readonly scene: ProgressScene, private readonly changed: () => void = () => {}, private readonly distanceToComplete = 6) {
    if (!Number.isFinite(distanceToComplete) || distanceToComplete <= 0) throw new Error('移动距离必须大于零。');
  }

  get state(): ProgressState {
    return { mode: this.mode, growth: this.growth, decoration: this.decoration };
  }

  reset(): void {
    this.mode = 'growth';
    this.growth = 0;
    this.decoration = 0;
    this.scene.startInteraction();
    this.changed();
  }

  setMode(mode: ProgressMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.changed();
  }

  update(frame: ContinuousGestureFrame): void {
    if (frame.pinchStarted) {
      this.setMode('decoration');
      return;
    }
    if (!frame.pointing || frame.pinching || !Number.isFinite(frame.movementDelta) || frame.movementDelta <= 0) return;
    const amount = frame.movementDelta / this.distanceToComplete;
    if (this.mode === 'growth') {
      const next = Math.min(1, this.growth + amount);
      if (next === this.growth) return;
      this.growth = next;
      this.scene.setGrowthProgress(next);
    } else {
      // Decoration cannot extend beyond the tree that actually exists.
      const next = Math.min(this.growth, this.decoration + amount);
      if (next === this.decoration) return;
      this.decoration = next;
      this.scene.setDecorationProgress(next);
    }
    this.changed();
  }
}
