from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import math
import os
import re
import sys
import tempfile
import threading
import time
import uuid
import wave
from pathlib import Path
from typing import Any

# Make pip-installed CUDA runtime DLLs visible before importing CTranslate2.
_cuda_dll_handles: list[Any] = []
if os.name == "nt":
    nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    for relative_path in ("cublas/bin", "cudnn/bin", "cuda_runtime/bin", "cuda_nvrtc/bin"):
        dll_directory = nvidia_root / relative_path
        if dll_directory.exists():
            os.environ["PATH"] = f"{dll_directory}{os.pathsep}{os.environ.get('PATH', '')}"
            _cuda_dll_handles.append(os.add_dll_directory(str(dll_directory)))

# The official Hugging Face endpoint is often unreachable on mainland networks.
os.environ.setdefault("HF_ENDPOINT", os.getenv("LINGUA_HF_ENDPOINT", "https://hf-mirror.com"))
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import ctranslate2
from deep_translator import GoogleTranslator
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from opencc import OpenCC
import requests


HOST = os.getenv("LINGUA_HOST", "127.0.0.1")
PORT = int(os.getenv("LINGUA_PORT", "8787"))
MODEL_NAME = os.getenv("LINGUA_MODEL", "large-v3-turbo")
REQUESTED_DEVICE = os.getenv("LINGUA_DEVICE", "auto").lower()
DEVICE = "cuda" if REQUESTED_DEVICE == "auto" and ctranslate2.get_cuda_device_count() > 0 else REQUESTED_DEVICE
if DEVICE not in {"cpu", "cuda"}:
    DEVICE = "cpu"
COMPUTE_TYPE = os.getenv("LINGUA_COMPUTE_TYPE", "float16" if DEVICE == "cuda" else "int8")
TRANSLATOR_NAME = os.getenv("LINGUA_TRANSLATOR", "auto").lower()
OLLAMA_URL = os.getenv("LINGUA_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("LINGUA_OLLAMA_MODEL", "").strip()
LLM_URL = os.getenv("LINGUA_LLM_URL", "").strip()
LLM_API_KEY = os.getenv("LINGUA_LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LINGUA_LLM_MODEL", "").strip()
MODEL_SOURCE = os.getenv("LINGUA_MODEL_SOURCE", "modelscope").lower()
MODEL_CACHE_ROOT = Path(os.getenv("LINGUA_MODEL_DIR", Path(__file__).parent / "models"))
CPU_THREADS = int(os.getenv("LINGUA_CPU_THREADS", str(min(8, os.cpu_count() or 4))))
DESKTOP_TOKEN = os.getenv("LINGUA_DESKTOP_TOKEN", "")

MODELSCOPE_MODELS = {
    "small": {
        "repository": "Systran/faster-whisper-small",
        "files": {
            "config.json": 2_370,
            "model.bin": 483_546_902,
            "tokenizer.json": 2_203_239,
            "vocabulary.txt": 459_861,
        },
    },
    "large-v3-turbo": {
        "repository": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "files": {
            "config.json": 2_263,
            "model.bin": 1_617_884_929,
            "preprocessor_config.json": 340,
            "tokenizer.json": 2_710_337,
            "vocabulary.json": 1_068_114,
        },
    },
}

WHISPER_LANGUAGES = {
    "auto": None,
    "zh": "zh",
    "yue": "zh",
    "zh-sichuan": "zh",
    "ja": "ja",
    "en": "en",
    "ko": "ko",
    "fr": "fr",
    "de": "de",
}

LANGUAGE_LABELS = {
    "zh": "中文",
    "yue": "粤语",
    "zh-sichuan": "四川话",
    "ja": "日语",
    "en": "英语",
    "ko": "韩语",
    "fr": "法语",
    "de": "德语",
}

TRANSLATION_CODES = {
    "zh": "zh-CN",
    "yue": "zh-CN",
    "zh-sichuan": "zh-CN",
    "ja": "ja",
    "en": "en",
    "ko": "ko",
    "fr": "fr",
    "de": "de",
}

DIALECT_PROMPTS = {
    "yue": "以下内容是粤语对话，请使用粤语原词准确转写，不要翻译成普通话。",
    "zh-sichuan": "以下内容是四川方言对话，请按实际发音和语义准确转写。",
}

LANGUAGE_NAMES = {
    "zh": "Simplified Chinese",
    "yue": "Simplified Chinese",
    "zh-sichuan": "Simplified Chinese",
    "ja": "Japanese",
    "en": "English",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
}

_preload_tasks: list[asyncio.Task[None]] = []


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _preload_tasks
    if os.getenv("LINGUA_PRELOAD_MODEL", "1") != "0":
        _preload_tasks.append(asyncio.create_task(asyncio.to_thread(warmup_model)))
    if TRANSLATOR_NAME in {"auto", "ollama"} and os.getenv("LINGUA_PRELOAD_TRANSLATOR", "1") != "0":
        _preload_tasks.append(asyncio.create_task(asyncio.to_thread(warmup_translator)))
    yield


app = FastAPI(title="Lingua Live Local Service", version="0.7.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"] ,
    allow_headers=["*"],
)

_model: WhisperModel | None = None
_model_state = "not_loaded"
_model_error: str | None = None
_device_fallback: str | None = None
_model_downloaded_bytes = 0
_model_spec = MODELSCOPE_MODELS.get(MODEL_NAME)
_model_total_bytes = sum(_model_spec["files"].values()) if _model_spec else 0
_model_lock = threading.Lock()
_inference_lock = threading.Lock()
_translation_session = requests.Session()
_opencc = OpenCC("t2s")
_translator_state = "not_loaded"
_translator_error: str | None = None
_active_translator = "none"
_selected_ollama_model: str | None = None


def download_modelscope_file(url: str, destination: Path, expected_size: int) -> None:
    global _model_downloaded_bytes
    partial = destination.with_suffix(destination.suffix + ".part")
    destination.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(4):
        existing_size = partial.stat().st_size if partial.exists() else 0
        headers = {"Range": f"bytes={existing_size}-"} if existing_size else {}
        try:
            with requests.get(url, headers=headers, stream=True, timeout=(20, 180)) as response:
                response.raise_for_status()
                if existing_size and response.status_code != 206:
                    partial.unlink(missing_ok=True)
                    existing_size = 0
                mode = "ab" if existing_size else "wb"
                with partial.open(mode) as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            output.write(chunk)
                            _model_downloaded_bytes += len(chunk)
            if partial.stat().st_size != expected_size:
                raise OSError(f"文件大小不正确：{partial.stat().st_size} / {expected_size}")
            partial.replace(destination)
            return
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def get_model_path() -> str:
    global _model_downloaded_bytes
    configured_path = Path(MODEL_NAME)
    if configured_path.exists():
        return str(configured_path)
    model_spec = MODELSCOPE_MODELS.get(MODEL_NAME)
    if MODEL_SOURCE != "modelscope" or model_spec is None:
        return MODEL_NAME

    model_directory = MODEL_CACHE_ROOT / f"faster-whisper-{MODEL_NAME}"
    model_files = model_spec["files"]
    complete_sizes = sum(
        expected_size
        for filename, expected_size in model_files.items()
        if (model_directory / filename).exists() and (model_directory / filename).stat().st_size == expected_size
    )
    partial_sizes = sum(
        min((model_directory / f"{filename}.part").stat().st_size, expected_size)
        for filename, expected_size in model_files.items()
        if (model_directory / f"{filename}.part").exists()
    )
    _model_downloaded_bytes = complete_sizes + partial_sizes

    for filename, expected_size in model_files.items():
        destination = model_directory / filename
        if destination.exists() and destination.stat().st_size == expected_size:
            continue
        destination.unlink(missing_ok=True)
        url = f"https://modelscope.cn/models/{model_spec['repository']}/resolve/master/{filename}"
        download_modelscope_file(url, destination, expected_size)
    return str(model_directory)


def get_model() -> WhisperModel:
    global _model, _model_state, _model_error, _device_fallback, DEVICE, COMPUTE_TYPE
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model
        _model_state = "loading"
        _model_error = None
        try:
            model_path = get_model_path()
            try:
                _model = WhisperModel(
                    model_path,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                    cpu_threads=CPU_THREADS,
                    num_workers=1,
                )
            except Exception as gpu_error:
                if DEVICE != "cuda":
                    raise
                _device_fallback = str(gpu_error)
                DEVICE = "cpu"
                COMPUTE_TYPE = "int8"
                _model = WhisperModel(
                    model_path,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                    cpu_threads=CPU_THREADS,
                    num_workers=1,
                )
            _model_state = "ready"
            return _model
        except Exception as exc:
            _model_state = "error"
            _model_error = str(exc)
            raise


def warmup_model() -> None:
    global _model, _model_state, _model_error, _device_fallback, DEVICE, COMPUTE_TYPE
    temporary_path: Path | None = None
    try:
        with _inference_lock:
            model = get_model()
            if DEVICE != "cuda":
                return

            _model_state = "loading"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temporary_file:
                temporary_path = Path(temporary_file.name)
            with wave.open(str(temporary_path), "wb") as silence:
                silence.setnchannels(1)
                silence.setsampwidth(2)
                silence.setframerate(16_000)
                silence.writeframes(b"\x00\x00" * 16_000)

            segments, _info = model.transcribe(
                str(temporary_path),
                language="en",
                beam_size=1,
                best_of=1,
                vad_filter=False,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            list(segments)
            _model_state = "ready"
    except Exception as gpu_error:
        if DEVICE != "cuda":
            _model_state = "error"
            _model_error = str(gpu_error)
            return

        _device_fallback = str(gpu_error)
        with _model_lock:
            _model = None
            DEVICE = "cpu"
            COMPUTE_TYPE = "int8"
        try:
            get_model()
        except Exception as cpu_error:
            _model_state = "error"
            _model_error = str(cpu_error)
    finally:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)


def normalize_language(language: str) -> str:
    return "zh" if language in {"zh", "yue", "zh-sichuan"} else language


def simplify_chinese(text: str, language: str) -> str:
    return _opencc.convert(text) if normalize_language(language) == "zh" else text


def clean_translation(text: str, target_language: str) -> str:
    cleaned = text.strip().strip('"').strip("'")
    for prefix in ("Translation:", "Translated text:", "译文：", "翻译："):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
    return simplify_chinese(cleaned, target_language)


def has_target_script(text: str, target_language: str) -> bool:
    normalized = normalize_language(target_language)
    if normalized == "zh":
        has_chinese = bool(re.search(r"[\u4e00-\u9fff]", text))
        has_plain_english_word = bool(re.search(r"\b[a-z]{2,}\b", text))
        return has_chinese and not has_plain_english_word
    if normalized == "ja":
        return bool(re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text))
    if normalized == "ko":
        return bool(re.search(r"[\uac00-\ud7af]", text))
    return True


def resolve_ollama_model() -> str:
    global _selected_ollama_model
    if OLLAMA_MODEL:
        return OLLAMA_MODEL
    if _selected_ollama_model:
        return _selected_ollama_model

    response = _translation_session.get(f"{OLLAMA_URL}/api/tags", timeout=(0.2, 1.0))
    response.raise_for_status()
    installed = {model.get("name") for model in response.json().get("models", [])}
    for candidate in ("qwen2.5:7b", "qwen2.5vl:7b", "qwen2.5:3b", "qwen2.5:1.5b"):
        if candidate in installed:
            _selected_ollama_model = candidate
            return candidate
    raise RuntimeError("未找到可用的本地 Qwen 翻译模型")


def ollama_translate(text: str, source_language: str, target_language: str, previous_text: str = "") -> str:
    model_name = resolve_ollama_model()
    source_name = LANGUAGE_NAMES.get(source_language, "the detected language")
    target_name = LANGUAGE_NAMES.get(target_language, target_language)
    prompt = f"{source_name} -> {target_name}\nSubtitle: {text}"
    response = _translation_session.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": model_name,
            "system": (
                f"You are a literal subtitle translator. Translate only the words present into {target_name}. "
                "The input may be an incomplete fragment. Never infer, paraphrase, complete, or add "
                "missing information. Preserve names, numbers and tone. Output only the translation."
            ),
            "prompt": prompt,
            "stream": False,
            "keep_alive": "30m",
            "options": {"temperature": 0, "num_predict": 96, "num_ctx": 1024},
        },
        timeout=(0.35, 3.0),
    )
    response.raise_for_status()
    translated = response.json().get("response", "")
    if not translated.strip():
        raise ValueError("本地模型返回空译文")
    cleaned = clean_translation(translated, target_language)
    if not has_target_script(cleaned, target_language):
        raise ValueError("本地译文语言与目标语言不一致")
    return cleaned


def llm_translate(text: str, source_language: str, target_language: str, previous_text: str = "") -> str:
    if not LLM_URL or not LLM_MODEL:
        raise RuntimeError("未配置联网大模型地址或模型名称")
    source_name = LANGUAGE_NAMES.get(source_language, "the detected language")
    target_name = LANGUAGE_NAMES.get(target_language, target_language)
    context_line = f"Previous subtitle (context only): {previous_text[-240:]}\n" if previous_text else ""
    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"
    response = _translation_session.post(
        LLM_URL,
        headers=headers,
        json={
            "model": LLM_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"Translate subtitles from {source_name} into {target_name}. The current line may be "
                        "an incomplete fragment. Be literal and concise; never add missing information. "
                        "Return only the current line translation without labels or explanation."
                    ),
                },
                {"role": "user", "content": f"{context_line}Current subtitle: {text}"},
            ],
            "temperature": 0,
            "max_tokens": 128,
            "stream": False,
        },
        timeout=(1.5, 10.0),
    )
    response.raise_for_status()
    translated = response.json()["choices"][0]["message"]["content"]
    cleaned = clean_translation(translated, target_language)
    if not cleaned or not has_target_script(cleaned, target_language):
        raise ValueError("联网大模型译文语言与目标语言不一致")
    return cleaned


def google_translate(text: str, source_language: str, target_language: str) -> str:
    response = _translation_session.get(
        "https://translate.googleapis.com/translate_a/single",
        params={
            "client": "gtx",
            "sl": TRANSLATION_CODES.get(source_language, "auto"),
            "tl": TRANSLATION_CODES.get(target_language, "zh-CN"),
            "dt": "t",
            "q": text,
        },
        timeout=(2, 5),
    )
    response.raise_for_status()
    translated = "".join(part[0] for part in response.json()[0] if part[0])
    if not translated:
        raise ValueError("在线翻译返回空译文")
    return clean_translation(translated, target_language)


def warmup_translator() -> None:
    global _translator_state, _translator_error, _active_translator
    _translator_state = "loading"
    _translator_error = None
    try:
        ollama_translate("Ready.", "en", "zh")
        _active_translator = f"ollama:{resolve_ollama_model()}"
        _translator_state = "ready"
    except Exception as exc:
        _translator_error = str(exc)
        _active_translator = "google-fallback" if TRANSLATOR_NAME == "auto" else "none"
        _translator_state = "fallback" if TRANSLATOR_NAME == "auto" else "error"


def translate_text(
    text: str,
    source_language: str,
    target_language: str,
    previous_text: str = "",
) -> tuple[str, str | None]:
    global _translator_state, _translator_error, _active_translator
    if not text or normalize_language(source_language) == normalize_language(target_language):
        return simplify_chinese(text, target_language), None
    if TRANSLATOR_NAME in {"none", "passthrough"}:
        return text, "翻译器已设为直通模式"
    if TRANSLATOR_NAME not in {"auto", "llm", "ollama", "google"}:
        return text, f"未知翻译器：{TRANSLATOR_NAME}"

    provider_errors: list[str] = []
    if TRANSLATOR_NAME == "llm" or (TRANSLATOR_NAME == "auto" and LLM_URL and LLM_MODEL):
        try:
            translated = llm_translate(text, source_language, target_language, previous_text)
            _translator_state = "ready"
            _translator_error = None
            _active_translator = f"llm:{LLM_MODEL}"
            return translated, None
        except Exception as exc:
            provider_errors.append(f"联网大模型：{exc}")
            _translator_error = str(exc)
            if TRANSLATOR_NAME == "llm":
                _translator_state = "error"
                return text, f"联网大模型翻译失败：{exc}"

    if TRANSLATOR_NAME in {"auto", "ollama"}:
        try:
            translated = ollama_translate(text, source_language, target_language, previous_text)
            _translator_state = "ready"
            _translator_error = None
            _active_translator = f"ollama:{resolve_ollama_model()}"
            return translated, None
        except Exception as exc:
            provider_errors.append(f"本地模型：{exc}")
            _translator_error = str(exc)
            if TRANSLATOR_NAME == "ollama":
                _translator_state = "error"
                return text, f"本地翻译暂时失败：{exc}"

    try:
        translated = google_translate(text, source_language, target_language)
        _active_translator = "google" if TRANSLATOR_NAME == "google" else "google-fallback"
        _translator_state = "ready" if TRANSLATOR_NAME == "google" else "fallback"
        warning = f"已切换在线翻译（{'；'.join(provider_errors)}）" if provider_errors else None
        return translated, warning
    except Exception as online_error:
        try:
            translated = GoogleTranslator(
                source=TRANSLATION_CODES.get(source_language, "auto"),
                target=TRANSLATION_CODES.get(target_language, "zh-CN"),
            ).translate(text)
            _active_translator = "deep-translator-fallback"
            _translator_state = "fallback"
            return clean_translation(translated or text, target_language), None
        except Exception:
            _translator_state = "error"
            return text, f"翻译暂时失败：{online_error}"


def transcribe_file(
    path: Path,
    source_language: str,
    target_language: str,
    previous_text: str = "",
    should_translate: bool = True,
) -> dict[str, Any]:
    requested_language = source_language if source_language in WHISPER_LANGUAGES else "auto"
    recognition_started_at = time.perf_counter()
    with _inference_lock:
        model = get_model()
        segments_iterator, info = model.transcribe(
            str(path),
            language=WHISPER_LANGUAGES[requested_language],
            initial_prompt=" ".join(filter(None, (DIALECT_PROMPTS.get(requested_language), previous_text[-240:]))),
            beam_size=1,
            best_of=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 180, "speech_pad_ms": 120},
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            without_timestamps=True,
        )
        segments = list(segments_iterator)
    recognition_ms = round((time.perf_counter() - recognition_started_at) * 1000)

    source_text = "".join(segment.text for segment in segments).strip()
    detected_code = requested_language if requested_language in {"yue", "zh-sichuan"} else info.language
    detected_code = detected_code if detected_code in LANGUAGE_LABELS else info.language
    source_text = simplify_chinese(source_text, detected_code)

    if not source_text:
        return {
            "sourceText": "",
            "translatedText": "",
            "detectedLanguage": LANGUAGE_LABELS.get(detected_code, detected_code or "未知"),
            "detectedLanguageCode": detected_code,
            "confidence": 0,
            "recognitionMs": recognition_ms,
            "translationMs": 0,
        }

    average_log_probability = sum(segment.avg_logprob for segment in segments) / len(segments)
    confidence = max(0.0, min(1.0, math.exp(average_log_probability)))
    translation_warning: str | None = None
    translated_text = ""
    translation_ms = 0
    if should_translate:
        translation_started_at = time.perf_counter()
        translated_text, translation_warning = translate_text(source_text, detected_code, target_language, previous_text)
        translation_ms = round((time.perf_counter() - translation_started_at) * 1000)

    result: dict[str, Any] = {
        "id": f"local-{uuid.uuid4().hex[:12]}",
        "sourceText": source_text,
        "translatedText": translated_text,
        "detectedLanguage": LANGUAGE_LABELS.get(detected_code, detected_code or "未知"),
        "detectedLanguageCode": detected_code,
        "confidence": round(confidence, 4),
        "timestamp": int(time.time() * 1000),
        "recognitionMs": recognition_ms,
        "translationMs": translation_ms,
    }
    if translation_warning:
        result["translationWarning"] = translation_warning
    return result


def format_srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def clean_subtitle_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def render_srt(entries: list[dict[str, Any]], mode: str) -> str:
    blocks: list[str] = []
    for index, entry in enumerate(entries, start=1):
        if mode == "bilingual":
            lines = [entry["sourceText"], entry["translatedText"]]
        elif mode == "source":
            lines = [entry["sourceText"]]
        else:
            lines = [entry["translatedText"]]

        text = "\n".join(line for line in lines if line)
        if not text:
            continue
        blocks.append(
            "\n".join(
                [
                    str(index),
                    f"{format_srt_timestamp(entry['start'])} --> {format_srt_timestamp(entry['end'])}",
                    text,
                ],
            ),
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def generate_subtitle_file(
    media_path: Path,
    source_language: str,
    target_language: str,
    display_mode: str,
) -> dict[str, Any]:
    if not media_path.exists() or not media_path.is_file():
        raise HTTPException(status_code=400, detail=f"媒体文件不存在：{media_path}")

    requested_language = source_language if source_language in WHISPER_LANGUAGES else "auto"
    should_translate = display_mode != "source"
    started_at = time.perf_counter()
    entries: list[dict[str, Any]] = []
    previous_text = ""

    with _inference_lock:
        model = get_model()
        segments_iterator, info = model.transcribe(
            str(media_path),
            language=WHISPER_LANGUAGES[requested_language],
            initial_prompt=DIALECT_PROMPTS.get(requested_language),
            beam_size=1,
            best_of=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 260, "speech_pad_ms": 160},
            condition_on_previous_text=True,
            without_timestamps=False,
        )
        segments = list(segments_iterator)

    detected_code = requested_language if requested_language in {"yue", "zh-sichuan"} else info.language
    detected_code = detected_code if detected_code in LANGUAGE_LABELS else info.language
    translation_warnings: list[str] = []

    for segment in segments:
        source_text = simplify_chinese(clean_subtitle_text(segment.text), detected_code)
        if not source_text:
            continue

        translated_text = ""
        if should_translate:
            translated_text, warning = translate_text(source_text, detected_code, target_language, previous_text)
            if warning:
                translation_warnings.append(warning)

        previous_text = source_text
        entries.append(
            {
                "start": float(segment.start),
                "end": max(float(segment.end), float(segment.start) + 0.2),
                "sourceText": source_text,
                "translatedText": translated_text,
            },
        )

    subtitle_text = render_srt(entries, display_mode)
    return {
        "sourceFile": str(media_path),
        "subtitleText": subtitle_text,
        "format": "srt",
        "displayMode": display_mode,
        "entryCount": len(entries),
        "detectedLanguage": LANGUAGE_LABELS.get(detected_code, detected_code or "未知"),
        "detectedLanguageCode": detected_code,
        "durationMs": round((time.perf_counter() - started_at) * 1000),
        "translationWarnings": translation_warnings[:5],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "modelState": _model_state,
        "modelLoaded": _model is not None,
        "modelError": _model_error,
        "modelDownloadProgress": round(min(1, _model_downloaded_bytes / _model_total_bytes), 4) if _model_total_bytes else 0,
        "modelSource": MODEL_SOURCE,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "cpuThreads": CPU_THREADS,
        "deviceFallback": _device_fallback,
        "translator": TRANSLATOR_NAME,
        "activeTranslator": _active_translator,
        "translatorState": _translator_state,
        "translatorError": _translator_error,
        "ollamaModel": _selected_ollama_model or OLLAMA_MODEL or "auto",
        "llmConfigured": bool(LLM_URL and LLM_MODEL),
        "llmModel": LLM_MODEL or None,
    }


@app.post("/v1/caption")
async def caption(
    audio: UploadFile = File(...),
    sourceLanguage: str = Form("auto"),
    targetLanguage: str = Form("zh"),
    previousText: str = Form(""),
    translate: bool = Form(True),
) -> dict[str, Any]:
    if sourceLanguage not in WHISPER_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"不支持的原始语言：{sourceLanguage}")
    if targetLanguage not in TRANSLATION_CODES:
        raise HTTPException(status_code=400, detail=f"不支持的目标语言：{targetLanguage}")

    suffix = Path(audio.filename or "chunk.webm").suffix or ".webm"
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary_file:
            temporary_path = Path(temporary_file.name)
            while chunk := await audio.read(1024 * 1024):
                temporary_file.write(chunk)
        return await asyncio.to_thread(
            transcribe_file,
            temporary_path,
            sourceLanguage,
            targetLanguage,
            previousText,
            translate,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"识别失败：{exc}") from exc
    finally:
        await audio.close()
        if temporary_path:
            temporary_path.unlink(missing_ok=True)


@app.post("/v1/subtitles")
async def subtitles(
    mediaPath: str = Form(...),
    sourceLanguage: str = Form("auto"),
    targetLanguage: str = Form("zh"),
    displayMode: str = Form("translation"),
    x_lingua_desktop_token: str = Header(""),
) -> dict[str, Any]:
    if not DESKTOP_TOKEN or x_lingua_desktop_token != DESKTOP_TOKEN:
        raise HTTPException(status_code=403, detail="字幕文件生成只能由 Lingua Live 桌面端调用")
    if sourceLanguage not in WHISPER_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"不支持的原始语言：{sourceLanguage}")
    if targetLanguage not in TRANSLATION_CODES:
        raise HTTPException(status_code=400, detail=f"不支持的目标语言：{targetLanguage}")
    if displayMode not in {"translation", "source", "bilingual"}:
        raise HTTPException(status_code=400, detail=f"不支持的字幕模式：{displayMode}")

    try:
        return await asyncio.to_thread(
            generate_subtitle_file,
            Path(mediaPath),
            sourceLanguage,
            targetLanguage,
            displayMode,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"字幕生成失败：{exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
