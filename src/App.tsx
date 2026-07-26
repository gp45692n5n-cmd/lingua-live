import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Globe2,
  Languages,
  LoaderCircle,
  MonitorUp,
  Move,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  Type,
  Volume2,
  Waves,
} from "lucide-react";
import { colorSwatches, defaultSettings, fontOptions, sourceLanguages, targetLanguages } from "./config";
import { useSystemAudio } from "./hooks/useSystemAudio";
import { languageLabel, localeOptions, translate } from "./i18n";
import { loadSettings, saveSettings } from "./lib/settings";
import { createTranslationEngine } from "./lib/translationEngine";
import type { AppSettings, BackendStatus, CaptionResult, HardwareProfile, OverlayBounds, SubtitleStyle, UiLocale } from "./types";

const initialBackendStatus: BackendStatus = {
  state: "stopped",
  message: "正在连接本地识别服务",
  model: "large-v3-turbo",
  modelState: "not_loaded",
  modelLoaded: false,
  modelDownloadProgress: 0,
  pid: null,
  logs: [],
};

function mergeSubtitleStyle(settings: AppSettings, patch: Partial<SubtitleStyle>): AppSettings {
  return {
    ...settings,
    subtitleStyle: {
      ...settings.subtitleStyle,
      ...patch,
    },
  };
}

function formatTime(timestamp: number, locale: UiLocale) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle" aria-hidden="true"><span /></span>
    </label>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [history, setHistory] = useState<CaptionResult[]>([]);
  const [currentCaption, setCurrentCaption] = useState<CaptionResult | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPositioning, setIsPositioning] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>(initialBackendStatus);
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const sequenceRef = useRef(0);
  const previousTextRef = useRef("");
  const processingRef = useRef(false);
  const pendingChunkRef = useRef<Blob | null>(null);
  const engine = useMemo(() => createTranslationEngine(settings), [settings]);
  const t = useCallback(
    (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(settings.uiLocale, key, values),
    [settings.uiLocale],
  );

  const processAudioChunk = useCallback((blob: Blob) => {
    pendingChunkRef.current = blob;
    if (processingRef.current) return;

    processingRef.current = true;
    setIsProcessing(true);
    void (async () => {
      try {
        while (pendingChunkRef.current) {
          const nextBlob = pendingChunkRef.current;
          pendingChunkRef.current = null;
          setEngineError(null);
          const sequence = sequenceRef.current++;

          try {
            const result = await engine.processAudio(nextBlob, {
              sourceLanguage: settings.sourceLanguage,
              targetLanguage: settings.targetLanguage,
              sequence,
              previousText: previousTextRef.current,
              translate: settings.subtitleStyle.displayMode !== "source",
            });
            if (!result) continue;

            previousTextRef.current = result.sourceText;
            setCurrentCaption(result);
            setHistory((items) => [result, ...items].slice(0, 40));
          } catch (reason) {
            setEngineError(reason instanceof Error ? reason.message : t("serviceUnavailable"));
          }
        }
      } finally {
        processingRef.current = false;
        setIsProcessing(false);
      }
    })();
  }, [engine, settings.sourceLanguage, settings.subtitleStyle.displayMode, settings.targetLanguage, t]);

  const audio = useSystemAudio({
    chunkDurationMs: settings.chunkDurationMs,
    onChunk: processAudioChunk,
    noAudioMessage: t("noSystemAudio"),
    captureErrorMessage: t("captureFailed"),
  });

  useEffect(() => {
    saveSettings(settings);
    window.desktopAPI?.updateOverlay({ caption: currentCaption, settings, positioning: isPositioning });
    void window.desktopAPI?.setOverlayVisible((settings.overlayVisible && audio.isCapturing) || isPositioning);
    void window.desktopAPI?.setOverlayInteractive(isPositioning);
    if (settings.overlayBounds) void window.desktopAPI?.setOverlayBounds(settings.overlayBounds);
  }, [audio.isCapturing, currentCaption, isPositioning, settings]);

  useEffect(() => {
    const unsubscribe = window.desktopAPI?.onOverlayPosition((bounds: OverlayBounds) => {
      setSettings((current) => ({ ...current, overlayBounds: bounds }));
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const desktopAPI = window.desktopAPI;
    if (!desktopAPI) return;

    const unsubscribe = desktopAPI.onBackendStatus(setBackendStatus);
    void desktopAPI.getBackendStatus().then(setBackendStatus);
    void desktopAPI.getHardwareProfile().then(setHardwareProfile);
    const poll = window.setInterval(() => {
      void desktopAPI.getBackendStatus().then(setBackendStatus);
    }, 3_000);
    return () => {
      window.clearInterval(poll);
      unsubscribe();
    };
  }, []);

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const updateStyle = (patch: Partial<SubtitleStyle>) => {
    setSettings((current) => mergeSubtitleStyle(current, patch));
  };

  const sourceName = languageLabel(settings.uiLocale, settings.sourceLanguage);
  const targetName = settings.targetLanguage === "zh" ? t("simplifiedChinese") : languageLabel(settings.uiLocale, settings.targetLanguage);
  const visibleError = audio.error ?? engineError;
  const backendUnavailable = settings.engine === "local" && backendStatus.state === "error";
  const backendBusy = settings.engine === "local"
    && (backendStatus.state === "starting" || backendStatus.modelState === "loading");
  const showSource = settings.subtitleStyle.displayMode !== "translation";
  const showTranslation = settings.subtitleStyle.displayMode !== "source";
  const backendMessage = backendStatus.modelState === "loading"
    ? backendStatus.modelDownloadProgress > 0 && backendStatus.modelDownloadProgress < 1
      ? t("backendDownloading", { model: backendStatus.model, progress: Math.round(backendStatus.modelDownloadProgress * 100) })
      : t("backendLoading", { model: backendStatus.model })
    : backendStatus.modelState === "ready"
      ? t(backendStatus.message.includes("本地翻译") || backendStatus.message.includes("Local translation") ? "backendReadyLocal" : "backendReadyOnline", {
          model: backendStatus.model,
          device: hardwareProfile?.cudaAvailable ? "CUDA" : "CPU",
        })
      : backendStatus.modelState === "error"
        ? `${t("backendError")}: ${backendStatus.message}`
        : backendStatus.state === "starting"
          ? t("backendStarting")
          : t("backendFirstLoad", { model: backendStatus.model });

  const copyCurrentCaption = () => {
    if (!currentCaption) return;
    const lines = [
      showSource ? currentCaption.sourceText : "",
      showTranslation ? currentCaption.translatedText : "",
    ].filter(Boolean);
    void navigator.clipboard.writeText(lines.join("\n"));
  };

  const handleCaptureToggle = async () => {
    if (audio.isCapturing) {
      pendingChunkRef.current = null;
      previousTextRef.current = "";
      audio.stop();
      return;
    }

    if (settings.engine === "local") {
      if (!window.desktopAPI) {
        setEngineError(t("desktopOnly"));
        return;
      }
      const status = await window.desktopAPI.startBackend();
      setBackendStatus(status);
      if (status.state !== "ready") {
        setEngineError(status.message);
        return;
      }
    }
    await audio.start();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Captions size={21} strokeWidth={2.2} /></span>
          <span className="brand-name">Lingua Live</span>
          <span className="brand-version">MVP 0.6</span>
        </div>
        <div className="topbar-status">
          <label className="locale-select" title={t("uiLanguage")}>
            <Globe2 size={15} />
            <select value={settings.uiLocale} onChange={(event) => updateSettings("uiLocale", event.target.value as UiLocale)}>
              {localeOptions.map((locale) => <option key={locale.id} value={locale.id}>{locale.label}</option>)}
            </select>
          </label>
          <span className={`status-dot ${audio.isCapturing ? "status-dot--live" : ""}`} />
          <span>{audio.isCapturing ? t("listening") : t("waiting")}</span>
          <button className="icon-button" title={t("settings")} aria-label={t("settings")}><Settings2 size={18} /></button>
        </div>
      </header>

      <section className="control-strip">
        <div className="source-summary">
          <MonitorUp size={20} />
          <div>
            <span className="eyebrow">{t("audioSource")}</span>
            <strong>{t("systemAudio")}</strong>
          </div>
        </div>

        <div className="route-summary" aria-label={t("translationDirection")}>
          <span>{sourceName}</span>
          <Languages size={18} />
          <span>{targetName}</span>
        </div>

        <div className="audio-meter" aria-label={t("audioLevel")}>
          <Volume2 size={18} />
          <div className="meter-track"><span style={{ width: `${Math.max(3, audio.level * 100)}%` }} /></div>
        </div>

        <button
          className={`primary-action ${audio.isCapturing ? "primary-action--stop" : ""}`}
          onClick={() => void handleCaptureToggle()}
          disabled={backendBusy && !audio.isCapturing}
        >
          {audio.isCapturing
            ? <Square size={17} fill="currentColor" />
            : backendBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
          {audio.isCapturing ? t("stopTranslation") : backendBusy ? t("startingService") : t("startTranslation")}
        </button>
      </section>

      <main className="workspace">
        <aside className="panel setup-panel">
          <div className="panel-heading">
            <Radio size={18} />
            <div><h2>{t("sessionSettings")}</h2><p>{t("sessionSettingsHint")}</p></div>
          </div>

          <div className="form-section">
            <label className="field">
              <span>{t("engine")}</span>
              <div className="select-wrap">
                <select value={settings.engine} onChange={(event) => updateSettings("engine", event.target.value as AppSettings["engine"])}>
                  <option value="local">{t("localEngine")}</option>
                  <option value="demo">{t("demoEngine")}</option>
                  <option value="http">{t("httpEngine")}</option>
                </select>
                <ChevronDown size={16} />
              </div>
            </label>

            {settings.engine === "demo" && (
              <div className="notice notice--demo">
                <CircleAlert size={16} />
                <span>{t("demoNotice")}</span>
              </div>
            )}

            {settings.engine === "local" && (
              <div className={`notice service-notice service-notice--${backendStatus.state}`}>
                {backendBusy ? <LoaderCircle className="spin" size={16} /> : <span className="service-indicator" />}
                <span>{backendMessage}</span>
                {backendUnavailable && (
                  <button
                    className="notice-action"
                    title={t("restartService")}
                    aria-label={t("restartService")}
                    onClick={() => void window.desktopAPI?.startBackend().then(setBackendStatus)}
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
              </div>
            )}

            {settings.engine === "http" && (
              <>
                <label className="field">
                  <span>{t("endpoint")}</span>
                  <input value={settings.endpoint} onChange={(event) => updateSettings("endpoint", event.target.value)} />
                </label>
                <label className="field">
                  <span>{t("apiKey")}</span>
                  <input type="password" value={settings.apiKey} placeholder={t("optional")} onChange={(event) => updateSettings("apiKey", event.target.value)} />
                </label>
              </>
            )}
          </div>

          <div className="form-section">
            <label className="field">
              <span>{t("sourceLanguage")}</span>
              <div className="select-wrap">
                <select value={settings.sourceLanguage} onChange={(event) => updateSettings("sourceLanguage", event.target.value)}>
                  {sourceLanguages.map((language) => <option key={language.id} value={language.id}>{languageLabel(settings.uiLocale, language.id)}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <label className="field">
              <span>{t("targetLanguage")}</span>
              <div className="select-wrap">
                <select value={settings.targetLanguage} onChange={(event) => updateSettings("targetLanguage", event.target.value)}>
                  {targetLanguages.map((language) => <option key={language.id} value={language.id}>{language.id === "zh" ? t("simplifiedChinese") : languageLabel(settings.uiLocale, language.id)}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <label className="field">
              <span>{t("audioChunk")}</span>
              <div className="select-wrap">
                <select value={settings.chunkDurationMs} onChange={(event) => updateSettings("chunkDurationMs", Number(event.target.value))}>
                  <option value={1000}>{t("chunkFast")}</option>
                  <option value={1500}>{t("chunkLive")}</option>
                  <option value={2500}>{t("chunkStable")}</option>
                  <option value={4000}>{t("chunkLong")}</option>
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
          </div>

          {hardwareProfile && (
            <div className="hardware-recommendation">
              <Cpu size={16} />
              <div>
                <strong>{t("hardwareTitle")}</strong>
                <span>{hardwareProfile.gpuName && hardwareProfile.vramGb
                  ? t("hardwareDetected", { gpu: hardwareProfile.gpuName, vram: hardwareProfile.vramGb, ram: hardwareProfile.memoryGb })
                  : t("hardwareCpu", { ram: hardwareProfile.memoryGb, threads: hardwareProfile.cpuThreads })}</span>
                <span>{t("recommendedModels", { asr: hardwareProfile.recommendedAsr, translator: hardwareProfile.recommendedTranslator })}</span>
              </div>
            </div>
          )}

          <div className="capability-list">
            <div><Check size={15} /><span>{t("systemCapture")}</span></div>
            <div><Check size={15} /><span>{t("autoDetection")}</span></div>
            <div><Check size={15} /><span>{t("displayModes")}</span></div>
          </div>
        </aside>

        <section className="panel transcript-panel">
          <div className="panel-heading panel-heading--split">
            <div className="heading-group">
              <Waves size={18} />
              <div><h2>{t("liveCaptions")}</h2><p>{audio.isCapturing ? (isProcessing ? t("translatingLive") : t("audioConnected")) : t("startHint")}</p></div>
            </div>
            <div className="panel-actions">
              <button className="icon-button" title={t("copyCaption")} aria-label={t("copyCaption")} disabled={!currentCaption} onClick={copyCurrentCaption}><Copy size={17} /></button>
              <button className="icon-button" title={t("clearHistory")} aria-label={t("clearHistory")} disabled={history.length === 0} onClick={() => { setHistory([]); setCurrentCaption(null); }}><Trash2 size={17} /></button>
            </div>
          </div>

          {visibleError && <div className="error-banner"><CircleAlert size={17} /><span>{visibleError}</span></div>}
          {currentCaption?.translationWarning && <div className="warning-banner"><CircleAlert size={17} /><span>{currentCaption.translationWarning}</span></div>}

          <div className="caption-preview-shell">
            <div className="preview-toolbar">
              <span>{t("overlayPreview")}</span>
              <span className="detected-language">{currentCaption?.detectedLanguageCode
                ? languageLabel(settings.uiLocale, currentCaption.detectedLanguageCode)
                : currentCaption?.detectedLanguage ?? t("detecting")}</span>
            </div>
            <div className="video-preview">
              <div className="preview-scene" aria-hidden="true">
                <div className="scene-window" />
                <div className="scene-light scene-light--one" />
                <div className="scene-light scene-light--two" />
              </div>
              <div
                className={`preview-caption preview-caption--${settings.subtitleStyle.position}`}
                style={{
                  fontFamily: settings.subtitleStyle.fontFamily,
                  fontSize: `${Math.max(16, settings.subtitleStyle.fontSize * 0.62)}px`,
                  backgroundColor: `${settings.subtitleStyle.backgroundColor}${Math.round(settings.subtitleStyle.backgroundOpacity * 255).toString(16).padStart(2, "0")}`,
                }}
              >
                {showSource && <span style={{ color: settings.subtitleStyle.textColor }}>{currentCaption?.sourceText ?? "Real-time captions appear here"}</span>}
                {showTranslation && <strong style={{ color: settings.subtitleStyle.translationColor }}>{currentCaption?.translatedText ?? t("previewTranslation")}</strong>}
              </div>
            </div>
          </div>

          <div className="history-header">
            <span>{t("recentHistory")}</span>
            <span>{t("itemCount", { count: history.length })}</span>
          </div>
          <div className="transcript-list">
            {history.length === 0 ? (
              <div className="empty-state">
                <Captions size={25} />
                <strong>{t("noCaptions")}</strong>
                <span>{t("noCaptionsHint")}</span>
              </div>
            ) : history.map((caption) => (
              <article className="transcript-item" key={caption.id}>
                <time>{formatTime(caption.timestamp, settings.uiLocale)}</time>
                <div>
                  {showSource && <p>{caption.sourceText}</p>}
                  {showTranslation && <strong>{caption.translatedText}</strong>}
                </div>
                <span
                  className="confidence"
                  title={caption.latencyMs
                    ? t("latencyDetail", { total: caption.latencyMs, asr: caption.recognitionMs ?? 0, translation: caption.translationMs ?? 0 })
                    : t("confidence", { value: Math.round(caption.confidence * 100) })}
                >
                  {caption.recognitionMs !== undefined || caption.translationMs !== undefined
                    ? `${(caption.recognitionMs ?? 0) + (caption.translationMs ?? 0)}ms`
                    : `${Math.round(caption.confidence * 100)}%`}
                </span>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel style-panel">
          <div className="panel-heading panel-heading--split">
            <div className="heading-group">
              <Type size={18} />
              <div><h2>{t("appearance")}</h2><p>{t("appearanceHint")}</p></div>
            </div>
            <button className="icon-button" title={t("resetStyle")} aria-label={t("resetStyle")} onClick={() => updateStyle(defaultSettings.subtitleStyle)}><RotateCcw size={17} /></button>
          </div>

          <div className="form-section">
            <label className="field">
              <span>{t("font")}</span>
              <div className="select-wrap">
                <select value={settings.subtitleStyle.fontFamily} onChange={(event) => updateStyle({ fontFamily: event.target.value })}>
                  {fontOptions.map((font) => <option key={font.value} value={font.value}>{font.value === "system-ui" ? t("systemFont") : font.label}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <label className="range-field">
              <span><span>{t("fontSize")}</span><output>{settings.subtitleStyle.fontSize}px</output></span>
              <input type="range" min={18} max={56} step={1} value={settings.subtitleStyle.fontSize} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} />
            </label>
          </div>

          <div className="form-section">
            <div className="swatch-field">
              <span>{t("sourceColor")}</span>
              <div className="swatches">
                {colorSwatches.map((color) => (
                  <button key={color} className={settings.subtitleStyle.textColor === color ? "swatch swatch--selected" : "swatch"} style={{ backgroundColor: color }} title={color} aria-label={t("selectSourceColor", { color })} onClick={() => updateStyle({ textColor: color })}>{settings.subtitleStyle.textColor === color && <Check size={13} />}</button>
                ))}
              </div>
            </div>
            <div className="swatch-field">
              <span>{t("translationColor")}</span>
              <div className="swatches">
                {colorSwatches.map((color) => (
                  <button key={color} className={settings.subtitleStyle.translationColor === color ? "swatch swatch--selected" : "swatch"} style={{ backgroundColor: color }} title={color} aria-label={t("selectTranslationColor", { color })} onClick={() => updateStyle({ translationColor: color })}>{settings.subtitleStyle.translationColor === color && <Check size={13} />}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="form-section">
            <label className="range-field">
              <span><span>{t("backgroundOpacity")}</span><output>{Math.round(settings.subtitleStyle.backgroundOpacity * 100)}%</output></span>
              <input type="range" min={0} max={0.9} step={0.05} value={settings.subtitleStyle.backgroundOpacity} onChange={(event) => updateStyle({ backgroundOpacity: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span><span>{t("outlineWidth")}</span><output>{settings.subtitleStyle.outlineWidth}px</output></span>
              <input type="range" min={0} max={5} step={1} value={settings.subtitleStyle.outlineWidth} onChange={(event) => updateStyle({ outlineWidth: Number(event.target.value) })} />
            </label>
          </div>

          <div className="form-section">
            <span className="group-label">{t("subtitlePosition")}</span>
            <div className="segmented-control">
              <button className={settings.subtitleStyle.position === "top" ? "selected" : ""} onClick={() => updateStyle({ position: "top" })}>{t("top")}</button>
              <button className={settings.subtitleStyle.position === "bottom" ? "selected" : ""} onClick={() => updateStyle({ position: "bottom" })}>{t("bottom")}</button>
            </div>
            <Toggle
              checked={settings.subtitleStyle.displayMode === "bilingual"}
              onChange={(value) => updateStyle({ displayMode: value ? "bilingual" : "translation" })}
              label={t("bilingual")}
            />
            {settings.subtitleStyle.displayMode !== "bilingual" && (
              <>
                <span className="group-label">{t("singleSubtitle")}</span>
                <div className="segmented-control">
                  <button className={settings.subtitleStyle.displayMode === "translation" ? "selected" : ""} onClick={() => updateStyle({ displayMode: "translation" })}>{t("translationOnly")}</button>
                  <button className={settings.subtitleStyle.displayMode === "source" ? "selected" : ""} onClick={() => updateStyle({ displayMode: "source" })}>{t("sourceOnly")}</button>
                </div>
              </>
            )}
          </div>

          <div className="style-actions">
            <button className="secondary-action" onClick={() => updateSettings("overlayVisible", !settings.overlayVisible)}>
              {settings.overlayVisible ? <EyeOff size={17} /> : <Eye size={17} />}
              {settings.overlayVisible ? t("hideOverlay") : t("showOverlay")}
            </button>
            <button
              className={`secondary-action ${isPositioning ? "secondary-action--active" : ""}`}
              onClick={() => {
                setIsPositioning((value) => !value);
                if (!isPositioning) updateSettings("overlayVisible", true);
              }}
            >
              <Move size={17} />
              {isPositioning ? t("finishPositioning") : t("positionOverlay")}
            </button>
          </div>
        </aside>
      </main>

      <footer className="statusbar">
        <span><span className={`status-dot ${audio.isCapturing ? "status-dot--live" : ""}`} />{audio.isCapturing ? t("liveSession") : t("systemReady")}</span>
        <span>{settings.engine === "local"
          ? t("localLabel", { model: backendStatus.model })
          : settings.engine === "demo" ? t("demoLabel") : t("httpLabel")} · {t("chunkLabel", { seconds: settings.chunkDurationMs / 1000 })}</span>
        <span><Radio size={13} /> {t("systemAudio")}</span>
      </footer>
    </div>
  );
}
