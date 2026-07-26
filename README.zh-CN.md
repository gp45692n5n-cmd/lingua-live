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
- 支持整部电影生成单语或双语 `.srt` 字幕
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
git clone https://github.com/gp45692n5n-cmd/lingua-live.git
cd lingua-live
npm.cmd install
npm.cmd run setup:backend:gpu
npm.cmd run build
npm.cmd start
```

没有 NVIDIA 显卡时运行：

```powershell
npm.cmd run setup:backend
```

识别模型会在首次启动时下载，模型、虚拟环境和构建产物不会提交到 Git。如果 PowerShell 拦截 `npm`，请使用 `npm.cmd`。

本地翻译可安装 Ollama，并按电脑配置拉取模型：

```powershell
ollama pull qwen2.5:7b
```

## 电影字幕模式

如果你想单独翻译一部电影，可以使用主界面里的“电影字幕文件”区域：

1. 选择视频或音频文件。
2. 选择“仅译文替代”生成单语翻译字幕，或选择“双语字幕”保留原文加译文。
3. 生成并保存 `.srt` 文件。
4. 在播放器里加载这个新 `.srt`，用它替代原来的软字幕轨道。

这个功能是“生成新的外挂字幕来替代原软字幕”。如果原字幕已经烧录在画面里，它暂时不会把画面里的硬字幕擦掉；硬字幕遮挡、字体匹配和重新压制视频会作为后续功能扩展。

出于安全考虑，整文件字幕生成接口需要 Electron 桌面端生成的本次会话令牌，避免普通网页通过本地端口请求读取电脑文件。

## 当前边界

- 当前仍是短音频分段，不是逐词流式识别。
- 1 秒极速模式会增加残句和翻译歧义，1.5 秒模式更稳。
- 粤语和四川话暂时使用 Whisper 中文识别配合提示词，后续会接入专用方言模型。
- 当前捕获整个系统混音，尚不能只选择某个浏览器标签页或应用。
- 电影字幕模式会导出替代字幕文件，暂未实现硬字幕去除、字体自动匹配和视频烧录。
- 当前仓库提供源码构建，签名的 Windows 安装程序将在后续提供。

## 开源说明

项目代码使用 [MIT License](LICENSE)。自动下载的语音识别和翻译模型拥有各自许可证，仓库不会分发这些模型文件。
