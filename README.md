# Lingua Live

[简体中文](README.zh-CN.md) | English

Lingua Live is a Windows desktop app that captures system playback audio, transcribes speech locally with `faster-whisper`, translates it, and renders transparent always-on-top captions over any browser or video player.

## Highlights

- Real Windows system-audio loopback capture
- CUDA-accelerated `faster-whisper` with automatic CPU fallback
- Mandarin, Cantonese, Sichuan dialect, Japanese, English, Korean, French and German inputs
- Chinese, English, Japanese, Korean, French and German translation targets
- Local Ollama translation, Google fallback and OpenAI-compatible cloud endpoints
- Simplified Chinese normalization with OpenCC
- Translation-only, source-only and bilingual caption modes
- Transparent movable overlay with configurable font, size, colors and outline
- UI languages: English, Simplified Chinese, Japanese, Korean, French and German
- Automatic hardware detection and model recommendations

## Hardware Profiles

Lingua Live reads the NVIDIA GPU model, VRAM, system memory and CPU thread count. The desktop app chooses a safe default ASR model and displays a translation-model recommendation.

| Hardware | ASR default | Translation recommendation |
| --- | --- | --- |
| NVIDIA GPU with 12GB+ VRAM | `large-v3-turbo` | TranslateGemma 4B or Qwen 7B |
| NVIDIA GPU with 8-11GB VRAM | `large-v3-turbo` | TranslateGemma 4B or Qwen 3B |
| Smaller GPU or CPU-only | `small` | Qwen 1.5B or a cloud API |

See [Model Guide](docs/MODEL_GUIDE.md) for detailed tradeoffs.

## Requirements

- Windows 10 or Windows 11
- Node.js 20+
- Python 3.10-3.12
- Optional NVIDIA GPU for low-latency CUDA inference
- Optional [Ollama](https://ollama.com/) for fully local translation

## Quick Start

```powershell
git clone <repository-url>
cd lingua-live
npm install
powershell -ExecutionPolicy Bypass -File backend/setup.ps1 -Gpu
npm run build
npm start
```

Without an NVIDIA GPU, omit `-Gpu`:

```powershell
powershell -ExecutionPolicy Bypass -File backend/setup.ps1
```

The ASR model downloads on first launch. Models, virtual environments and build output are excluded from Git.

## Local Translation

Install Ollama and pull one model appropriate for the machine:

```powershell
ollama pull qwen2.5:7b
```

If Ollama is unavailable, Lingua Live falls back to online translation. An OpenAI-compatible endpoint can be configured with the variables in [.env.example](.env.example).

## API

Health:

```text
GET http://127.0.0.1:8787/health
```

Caption request:

```text
POST http://127.0.0.1:8787/v1/caption
Content-Type: multipart/form-data

audio: <webm/opus, wav, or another PyAV-supported format>
sourceLanguage: auto | zh | yue | zh-sichuan | ja | en | ko | fr | de
targetLanguage: zh | en | ja | ko | fr | de
previousText: <optional short context>
translate: true | false
```

## Current Limitations

- Audio is processed in short chunks rather than token-level streaming.
- One-second chunks are faster but incomplete phrases can reduce translation quality.
- Cantonese and Sichuan dialect currently use Whisper Chinese plus prompts; dedicated dialect routing is planned.
- The app captures the system mix, not an individual browser tab or application.
- Hard-subtitle removal and visual font matching are not implemented yet.
- The repository currently provides a source build; a signed Windows installer is planned.

## Development

```powershell
npm ci
npm run build
backend\.venv\Scripts\python.exe -m py_compile backend/server.py
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Security reports should follow [SECURITY.md](SECURITY.md).

## License

Lingua Live source code is licensed under the [MIT License](LICENSE). Downloaded ASR and translation models keep their own licenses and are not redistributed by this repository.
