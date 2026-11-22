import type { GestureEvent } from './gestures.js';

export type InteractionStage = 'waiting' | 'active' | 'growing' | 'ready' | 'decorated' | 'celebrating';

interface SceneActions {
  startInteraction(): void;
  setSnow(enabled: boolean): void;
  growTree(): void;
  decorate(): void;
  celebrate(): void;
}

export class AnimationController {
  stage: InteractionStage = 'waiting';
  private pending: 'decorate' | 'celebrate' | null = null;

  constructor(private readonly scene: SceneActions, private readonly changed: () => void = () => {}) {}

  reset(): void {
    this.pending = null;
    this.scene.startInteraction();
    this.setStage('waiting');
  }

  cancelPending(): void {
    this.pending = null;
  }

  handleGesture(gesture: GestureEvent): void {
    if (gesture === 'open-palm') {
      this.scene.setSnow(true);
      if (this.stage === 'waiting') this.setStage('active');
    } else if (gesture === 'pointing-up') {
      if (this.stage === 'growing') return;
      this.pending = null;
      this.setStage('growing');
      this.scene.growTree();
    } else if (gesture === 'two-palms') {
      if (this.stage === 'growing') {
        if (this.pending !== 'celebrate') this.pending = 'decorate';
      } else if (this.stage === 'ready' || this.stage === 'decorated' || this.stage === 'celebrating') {
        this.scene.decorate();
        this.setStage('decorated');
      } else {
        this.scene.setSnow(true);
        this.setStage('active');
      }
    } else if (gesture === 'heart') {
      if (this.stage === 'growing') this.pending = 'celebrate';
      else if (this.stage === 'ready' || this.stage === 'decorated' || this.stage === 'celebrating') {
        this.scene.celebrate();
        this.setStage('celebrating');
      }
    }
  }

  growthCompleted(): void {
    if (this.stage !== 'growing') return;
    this.setStage('ready');
    const pending = this.pending;
    this.pending = null;
    if (pending === 'decorate') this.handleGesture('two-palms');
    else if (pending === 'celebrate') this.handleGesture('heart');
  }

  celebrationCompleted(): void {
    if (this.stage === 'celebrating') this.setStage('decorated');
  }

  private setStage(stage: InteractionStage): void {
    this.stage = stage;
    this.changed();
  }
}
