export interface VisionHand {
  handedness: 'Left' | 'Right' | 'Unknown';
  score: number;
  gesture: string;
  gestureScore: number;
  landmarks: Array<{ x: number; y: number; z: number }>;
}

export interface VisionFrame {
  hands: VisionHand[];
  inferenceMs: number;
}

export type VisionRequest =
  | { type: 'initialize'; id: number; baseUrl: string }
  | { type: 'recognize'; id: number; bitmap: ImageBitmap; timestampMs: number };

export type VisionResponse =
  | { type: 'initialized'; id: number }
  | { type: 'result'; id: number; frame: VisionFrame }
  | { type: 'error'; id: number; message: string };
