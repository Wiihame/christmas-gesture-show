type Capture = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export class CameraSession {
  private generation = 0;
  private stream: MediaStream | null = null;

  constructor(private readonly capture: Capture = (constraints) => navigator.mediaDevices.getUserMedia(constraints)) {}

  async start(deviceId?: string): Promise<MediaStream> {
    const generation = ++this.generation;
    this.releaseStream();

    const stream = await this.capture({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    });

    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('摄像头请求已取消。', 'AbortError');
    }

    this.stream = stream;
    return stream;
  }

  stop(): void {
    ++this.generation;
    this.releaseStream();
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
