import type { VisionHand } from './vision-types';

const connections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

interface HandPointer {
  x: number;
  y: number;
  color: string;
}

export function drawHands(canvas: HTMLCanvasElement, video: HTMLVideoElement, hands: VisionHand[], pointer: HandPointer | null = null): void {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const hand of hands) {
    const color = hand.handedness === 'Right' ? '#9dccff' : '#c5edb5';
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.lineCap = 'round';

    for (const [start, end] of connections) {
      const a = hand.landmarks[start];
      const b = hand.landmarks[end];
      if (!a || !b) continue;
      context.beginPath();
      context.moveTo(a.x * canvas.width, a.y * canvas.height);
      context.lineTo(b.x * canvas.width, b.y * canvas.height);
      context.stroke();
    }

    for (const point of hand.landmarks) {
      context.beginPath();
      context.arc(point.x * canvas.width, point.y * canvas.height, 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)
    || pointer.x < 0 || pointer.x > 1 || pointer.y < 0 || pointer.y > 1) return;

  // The video and canvas share a CSS mirror, so keep the tracked coordinates raw.
  const x = pointer.x * canvas.width;
  const y = pointer.y * canvas.height;
  const radius = Math.max(6, Math.min(canvas.width, canvas.height) * 0.024);
  context.save();
  context.fillStyle = pointer.color;
  context.shadowColor = pointer.color;
  context.shadowBlur = radius * 2;
  context.beginPath();
  context.arc(x, y, radius * 0.6, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = pointer.color;
  context.lineWidth = Math.max(2, radius * 0.2);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
