# 模型验证图片

以下图片来自 MediaPipe 官方测试资源，用于在浏览器中将图片绘入 Canvas，再以 captureStream 模拟摄像头，调用真实的 GestureRecognizer：

- [official-right_hands.jpg](https://storage.googleapis.com/mediapipe-assets/right_hands.jpg)：两只右手，验证 numHands=2、每只手21个关键点及张掌分类。
- [official-fist.jpg](https://storage.googleapis.com/mediapipe-assets/fist.jpg)：握拳。
- [official-pointing_up.jpg](https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg)：食指向上。

资源名可在 [MediaPipe 官方测试 BUILD](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/testdata/vision/BUILD) 中核对。

open-palm.jpg、two-hands.jpg 是本任务小红书参考视频上半部分的采样，画面已带原作者骨架标注，只作参考回放。正式的双手数量与手势验证使用上面的官方图片。

这些文件不包含在生产构建。模拟视频验证不代表实体摄像头或真实授权弹窗已经验证。

下载的 JPG 图片也不提交到 Git 仓库。运行真实模型浏览器回放前，请从上面的官方链接将对应图片下载到本目录；单元测试与合成手势浏览器回放不需要这些图片。
