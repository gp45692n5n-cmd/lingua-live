# Model and Hardware Guide

Lingua Live runs ASR and translation at the same time. A model fitting on the GPU by itself is not enough: leave VRAM for both models, CUDA libraries, the desktop compositor and the video player.

## Recommended Profiles

| Tier | Typical hardware | ASR | Local translation | Chunk size |
| --- | --- | --- | --- | --- |
| High | NVIDIA 12-24GB VRAM, 16GB+ RAM | `large-v3-turbo` FP16 | TranslateGemma 4B or Qwen 7B quantized | 1.0-1.5s |
| Balanced | NVIDIA 8-11GB VRAM, 16GB RAM | `large-v3-turbo` FP16 | TranslateGemma 4B or Qwen 3B quantized | 1.5-2.5s |
| Lightweight | NVIDIA under 8GB or CPU-only | `small` INT8 | Qwen 1.5B or cloud translation | 2.5-4.0s |

## ASR Models

- `large-v3-turbo`: best default for multilingual real-time recognition on modern NVIDIA GPUs.
- `small`: lower memory and CPU requirements, with reduced dialect and noisy-audio accuracy.
- `large-v3`: useful for offline high-accuracy transcription, but usually too slow for this app's live path.

## Translation Models

- TranslateGemma 4B: preferred for literal subtitle translation when available.
- Qwen 7B: useful for conversational context and incomplete spoken phrases.
- Qwen 3B/1.5B: lower latency and memory, but more likely to add words or switch languages.
- Cloud LLM: strongest difficult-sentence fallback, but network latency, cost and privacy must be considered.

Visual-language and coding models are not recommended for the normal translation path. Their extra capabilities consume memory without improving text-only subtitles.

## Overrides

Copy `.env.example` and set environment variables before launching, or export them in the shell:

```powershell
$env:LINGUA_MODEL = "small"
$env:LINGUA_OLLAMA_MODEL = "qwen2.5:3b"
npm start
```

The desktop recommendation is a starting point. Measure recognition and translation latency with the media and languages that matter to your users.
