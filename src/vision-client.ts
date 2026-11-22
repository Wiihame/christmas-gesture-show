import type { VisionFrame, VisionRequest, VisionResponse } from './vision-types';

interface PendingRequest {
  resolve: (message: VisionResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class VisionClient {
  private worker: Worker | null = null;
  private initializing: Promise<void> | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private ready = false;
  private busy = false;
  private closed = false;
  private lastTimestamp = -1;

  initialize(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('识别服务已关闭，请重新启动摄像头。'));
    }
    if (this.ready) return Promise.resolve();
    if (this.initializing) return this.initializing;

    this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (event: MessageEvent<VisionResponse>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timeout);
      this.pending.delete(event.data.id);
      if (event.data.type === 'error') {
        request.reject(new Error(event.data.message));
      } else {
        request.resolve(event.data);
      }
    });
    this.worker.addEventListener('error', (event) => {
      this.fail(new Error(event.message || '识别服务启动失败。'));
    });
    this.worker.addEventListener('messageerror', () => {
      this.fail(new Error('无法读取手势识别结果。'));
    });

    this.initializing = this.send(
      {
        type: 'initialize',
        id: ++this.nextId,
        baseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
      },
      20_000,
    )
      .then((message) => {
        if (message.type !== 'initialized' || this.closed) {
          throw new Error('识别服务初始化已取消。');
        }
        this.ready = true;
      })
      .catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new Error('模型加载失败。'));
        throw error;
      })
      .finally(() => {
        this.initializing = null;
      });

    return this.initializing;
  }

  async recognize(
    video: HTMLVideoElement,
    timestampMs: number,
  ): Promise<VisionFrame | null> {
    if (!this.ready || this.closed || this.busy || video.readyState < 2) return null;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    if (!Number.isFinite(timestampMs) || timestampMs <= this.lastTimestamp) return null;

    this.busy = true;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(video);
      if (this.closed || !this.ready) return null;
      this.lastTimestamp = timestampMs;
      const message = await this.send(
        { type: 'recognize', id: ++this.nextId, bitmap, timestampMs },
        8_000,
        [bitmap],
      );
      if (message.type !== 'result') {
        throw new Error('手势识别返回了无效结果。');
      }
      return message.frame;
    } finally {
      bitmap?.close();
      this.busy = false;
    }
  }

  close(): void {
    this.fail(new Error('识别服务已停止。'));
  }

  private send(
    message: VisionRequest,
    timeoutMs: number,
    transfer: Transferable[] = [],
  ): Promise<VisionResponse> {
    return new Promise((resolve, reject) => {
      if (!this.worker || this.closed) {
        reject(new Error('识别服务未启动。'));
        return;
      }
      const timeout = setTimeout(() => {
        this.fail(
          new Error(
            message.type === 'initialize'
              ? '手势模型加载超时，请重试。'
              : '手势识别超时，请重新启动摄像头。',
          ),
        );
      }, timeoutMs);
      this.pending.set(message.id, { resolve, reject, timeout });
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('无法提交识别图像。'));
      }
    });
  }

  private fail(error: Error): void {
    this.closed = true;
    this.ready = false;
    this.busy = false;
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}
