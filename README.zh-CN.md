# Lingua Live

简体中文 | [English](README.md)

Lingua Live 是一款 Windows 实时字幕工具。它捕获电脑正在播放的系统声音，使用本地 `faster-whisper` 识别语音，再将透明、置顶的字幕显示在网页视频或本地播放器上方。

## 主要功能

- Windows 系统音频回环捕获
- NVIDIA CUDA 加速，失败时自动回退 CPU
- 支持普通话、粤语、四川话、日语、英语、韩语、法语和德语输入
- 支持中、英、日、韩、法、德目标语言
- 本地 Ollama、Google 回退及 OpenAI 兼容联网大模型接口
- 中文原文与译文自动转换为简体中文
- 仅译文、仅原文和双语字幕模式
- 字体、字号、颜色、描边、透明度和字幕位置设置
- 中文、英文、日文、韩文、法文和德文界面
- 自动检测 GPU、显存、内存和 CPU，并推荐模型配置

## 配置推荐

| 电脑配置 | 识别模型 | 翻译模型建议 |
| --- | --- | --- |
| NVIDIA 12GB 以上显存 | `large-v3-turbo` | TranslateGemma 4B 或 Qwen 7B |
| NVIDIA 8-11GB 显存 | `large-v3-turbo` | TranslateGemma 4B 或 Qwen 3B |
| 小显存或纯 CPU | `small` | Qwen 1.5B 或联网翻译 |

详细说明见[模型配置指南](docs/MODEL_GUIDE.md)。

## 环境要求

- Windows 10 或 Windows 11
- Node.js 20+
- Python 3.10-3.12
- NVIDIA 显卡为可选，但实时体验建议使用
- Ollama 为可选，用于完全本地翻译

## 从源码运行

```powershell
git clone <repository-url>
cd lingua-live
npm install
powershell -ExecutionPolicy Bypass -File backend/setup.ps1 -Gpu
npm run build
npm start
```

没有 NVIDIA 显卡时去掉 `-Gpu`。识别模型会在首次启动时下载，模型、虚拟环境和构建产物不会提交到 Git。

本地翻译可安装 Ollama，并按电脑配置拉取模型：

```powershell
ollama pull qwen2.5:7b
```

## 当前边界

- 当前仍是短音频分段，不是逐词流式识别。
- 1 秒极速模式会增加残句和翻译歧义，1.5 秒模式更稳。
- 粤语和四川话暂时使用 Whisper 中文识别配合提示词，后续会接入专用方言模型。
- 当前捕获整个系统混音，尚不能只选择某个浏览器标签页或应用。
- 暂未实现硬字幕去除、字体自动匹配和画面修复。
- 当前仓库提供源码构建，签名的 Windows 安装程序将在后续提供。

## 开源说明

项目代码使用 [MIT License](LICENSE)。自动下载的语音识别和翻译模型拥有各自许可证，仓库不会分发这些模型文件。
