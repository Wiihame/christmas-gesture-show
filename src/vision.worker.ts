import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import type {
  VisionFrame,
  VisionHand,
  VisionRequest,
  VisionResponse,
} from './vision-types';

let recognizer: GestureRecognizer | null = null;

function reply(message: VisionResponse): void {
  self.postMessage(message);
}

async function handleRequest(request: VisionRequest): Promise<void> {
  try {
    if (request.type === 'initialize') {
      recognizer?.close();
      recognizer = null;
      // Module workers need the SDK's ES-module WASM loader.
      const wasm = await FilesetResolver.forVisionTasks(
        new URL('mediapipe/wasm', request.baseUrl).href,
        true,
      );
      recognizer = await GestureRecognizer.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: new URL(
            'mediapipe/gesture_recognizer.task',
            request.baseUrl,
          ).href,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
      reply({ type: 'initialized', id: request.id });
      return;
    }

    if (!recognizer) {
      throw new Error('手势模型尚未准备好。');
    }

    const startedAt = performance.now();
    const result = recognizer.recognizeForVideo(request.bitmap, request.timestampMs);
    const frame: VisionFrame = {
      inferenceMs: performance.now() - startedAt,
      hands: result.landmarks.map((landmarks, index): VisionHand => {
        const handedness = result.handedness[index]?.[0];
        const gesture = result.gestures[index]?.[0];
        return {
          handedness:
            handedness?.categoryName === 'Left' || handedness?.categoryName === 'Right'
              ? handedness.categoryName
              : 'Unknown',
          score: handedness?.score ?? 0,
          gesture: gesture?.categoryName ?? 'None',
          gestureScore: gesture?.score ?? 0,
          landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
        };
      }),
    };
    reply({ type: 'result', id: request.id, frame });
  } catch (error) {
    reply({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : '手势识别发生错误。',
    });
  } finally {
    if (request.type === 'recognize') {
      request.bitmap.close();
    }
  }
}

self.addEventListener('message', (event: MessageEvent<VisionRequest>) => {
  void handleRequest(event.data);
});
