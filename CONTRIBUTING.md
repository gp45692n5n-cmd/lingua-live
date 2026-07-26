# Contributing

Thank you for contributing to Lingua Live.

## Setup

1. Use Windows 10/11, Node.js 20+ and Python 3.10-3.12.
2. Run `npm ci`.
3. Run `backend/setup.ps1` with `-Gpu` only on supported NVIDIA systems.
4. Run `npm run build` before submitting a pull request.

## Pull Requests

- Keep changes focused and preserve existing user settings during migrations.
- Do not commit models, virtual environments, credentials or generated build output.
- Add test evidence for recognition, translation or latency changes.
- Keep English UI strings complete. Add translations when practical; missing locale strings fall back to English.
- Document new environment variables and external services.

## Model Changes

Record the model name, quantization, license, VRAM usage, warm latency and at least one multilingual quality comparison. Do not redistribute third-party model weights without explicit license permission.
