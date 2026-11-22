import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChristmasScene } from '../src/christmas-scene.js';

class SceneContainer extends EventTarget {
  dataset: Record<string, string> = {};
}

interface FireworksFixture {
  container: SceneContainer;
  continuous: boolean;
  disposed: boolean;
  growthProgress: number;
  decorationProgress: number;
  decorationCalls: number;
  elapsed: number;
  celebrationStart: number | null;
  celebrationCount: number;
  presents: { visible: boolean };
  lightString: { visible: boolean };
  celebration: { visible: boolean; material: { uniforms: { uAge: { value: number } } } };
  celebrate(): void;
  updateCelebration(): void;
  cancelCelebration(): void;
}

// Exercise scene commands without creating a DOM canvas or WebGL context.
function fireworksFixture(growth = 0.37, decoration = 0, continuous = true): FireworksFixture {
  const container = new SceneContainer();
  container.dataset.interactionStage = growth === 0 ? 'waiting' : decoration > 0 ? 'decorating' : 'growing';
  container.dataset.growthProgress = String(growth);
  container.dataset.decorationProgress = String(decoration);
  const state = Object.assign(Object.create(ChristmasScene.prototype), {
    container,
    continuous,
    disposed: false,
    growthProgress: growth,
    decorationProgress: decoration,
    decorationCalls: 0,
    elapsed: 0,
    celebrationStart: null,
    celebrationCount: 0,
    presents: { visible: decoration > 0 && growth > 0 },
    lightString: { visible: decoration > 0 && growth > 0 },
    celebration: { visible: false, material: { uniforms: { uAge: { value: 0 } } } },
    decorate() {
      ++this.decorationCalls;
      this.growthProgress = 1;
      this.decorationProgress = 1;
      this.presents.visible = true;
      this.lightString.visible = true;
      this.container.dataset.interactionStage = 'decorated';
      this.container.dataset.growthProgress = '1';
      this.container.dataset.decorationProgress = '1';
    },
  }) as FireworksFixture;
  return state;
}

test('continuous fireworks preserve partial growth without completing decoration', () => {
  const scene = fireworksFixture();
  scene.celebrate();
  assert.equal(scene.growthProgress, 0.37);
  assert.equal(scene.decorationProgress, 0);
  assert.equal(scene.decorationCalls, 0);
  assert.equal(scene.container.dataset.interactionStage, 'growing');
  assert.equal(scene.container.dataset.growthProgress, '0.37');
  assert.equal(scene.container.dataset.decorationProgress, '0');
  assert.equal(scene.container.dataset.celebrationActive, 'true');
  assert.equal(scene.celebration.visible, true);
});

test('zero-progress trees can play fireworks while remaining empty', () => {
  const scene = fireworksFixture(0, 0);
  scene.celebrate();
  assert.equal(scene.growthProgress, 0);
  assert.equal(scene.decorationProgress, 0);
  assert.equal(scene.presents.visible, false);
  assert.equal(scene.lightString.visible, false);
  assert.equal(scene.celebration.visible, true);
  assert.equal(scene.container.dataset.interactionStage, 'waiting');
});

test('fireworks preserve the current decoration mode and latest mode on completion', () => {
  const scene = fireworksFixture(0.64, 0.38);
  let completed = 0;
  scene.container.addEventListener('tree-celebration-complete', () => ++completed);
  scene.celebrate();
  assert.equal(scene.container.dataset.interactionStage, 'decorating');
  assert.equal(scene.growthProgress, 0.64);
  assert.equal(scene.decorationProgress, 0.38);
  scene.container.dataset.interactionStage = 'growing';
  scene.elapsed = 1;
  scene.updateCelebration();
  assert.equal(scene.container.dataset.celebrationActive, 'true');
  scene.elapsed = 3;
  scene.updateCelebration();
  assert.equal(scene.container.dataset.interactionStage, 'growing');
  assert.equal(scene.container.dataset.celebrationActive, 'false');
  assert.equal(scene.celebration.visible, false);
  assert.equal(completed, 1);
  scene.elapsed = 6;
  scene.updateCelebration();
  assert.equal(completed, 1);
});

test('canceling a burst clears its markers and suppresses its completion event', () => {
  const scene = fireworksFixture();
  let completed = 0;
  scene.container.addEventListener('tree-celebration-complete', () => ++completed);
  scene.celebrate();
  scene.elapsed = 1;
  scene.updateCelebration();
  scene.cancelCelebration();
  scene.elapsed = 5;
  scene.updateCelebration();
  assert.equal(scene.container.dataset.celebrationActive, 'false');
  assert.equal(scene.container.dataset.celebrationAge, '0');
  assert.equal(scene.celebration.material.uniforms.uAge.value, 0);
  assert.equal(completed, 0);
});

test('separate fireworks rounds reuse the same particle material and uniforms', () => {
  const scene = fireworksFixture();
  const particles = scene.celebration;
  const material = particles.material;
  const uniforms = material.uniforms;
  for (let round = 0; round < 4; ++round) {
    scene.celebrate();
    scene.elapsed += 3;
    scene.updateCelebration();
    assert.equal(scene.celebration, particles);
    assert.equal(scene.celebration.material, material);
    assert.equal(scene.celebration.material.uniforms, uniforms);
  }
  assert.equal(scene.celebrationCount, 4);
  assert.equal(scene.decorationCalls, 0);
});

test('preview fireworks retain the previous decorate-and-celebrate behavior', () => {
  const scene = fireworksFixture(0.37, 0, false);
  scene.celebrate();
  assert.equal(scene.decorationCalls, 1);
  assert.equal(scene.container.dataset.interactionStage, 'celebrating');
  scene.elapsed = 3;
  scene.updateCelebration();
  assert.equal(scene.container.dataset.interactionStage, 'decorated');
});
