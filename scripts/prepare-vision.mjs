import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'public/mediapipe');
const modelPath = join(output, 'gesture_recognizer.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

await mkdir(output, { recursive: true });
await cp(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(output, 'wasm'), { recursive: true });

try {
  await access(modelPath);
} catch {
  console.log('正在下载固定版本的手势模型（首次安装需要联网）…');
  const temporaryPath = `${modelPath}.download`;
  try {
    const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1_000_000) throw new Error('模型文件异常，请重新下载。');
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, modelPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

const model = await readFile(modelPath);
const sdk = JSON.parse(await readFile(join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'));
await writeFile(join(output, 'manifest.json'), `${JSON.stringify({
  sdkVersion: sdk.version,
  modelUrl,
  modelSha256: createHash('sha256').update(model).digest('hex'),
}, null, 2)}\n`);
console.log(`本地识别资源已准备：MediaPipe ${sdk.version}，模型 ${(model.length / 1024 / 1024).toFixed(1)} MB。`);
