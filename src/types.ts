export type EngineKind = "local" | "demo" | "http";
export type CaptionPosition = "top" | "bottom";
export type SubtitleDisplayMode = "translation" | "source" | "bilingual";
export type UiLocale = "zh-CN" | "en" | "ja" | "ko" | "fr" | "de";
export type HardwareTier = "high" | "balanced" | "lightweight";

export type BackendState = "stopped" | "starting" | "ready" | "error";

export interface BackendStatus {
  state: BackendState;
  message: string;
  model: string;
  modelState: "not_loaded" | "loading" | "ready" | "error";
  modelLoaded: boolean;
  modelDownloadProgress: number;
  pid: number | null;
  logs: string[];
}

export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LanguageOption {
  id: string;
  label: string;
  shortLabel: string;
}

export interface CaptionResult {
  id: string;
  sourceText: string;
  translatedText: string;
  detectedLanguage: string;
  detectedLanguageCode?: string;
  confidence: number;
  timestamp: number;
  latencyMs?: number;
  recognitionMs?: number;
  translationMs?: number;
  isDemo?: boolean;
  translationWarning?: string;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  translationColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  position: CaptionPosition;
  displayMode: SubtitleDisplayMode;
}

export interface AppSettings {
  uiLocale: UiLocale;
  engine: EngineKind;
  sourceLanguage: string;
  targetLanguage: string;
  endpoint: string;
  apiKey: string;
  chunkDurationMs: number;
  overlayVisible: boolean;
  overlayBounds: OverlayBounds | null;
  subtitleStyle: SubtitleStyle;
}

export interface HardwareProfile {
  platform: string;
  cpuModel: string;
  cpuThreads: number;
  memoryGb: number;
  gpuName: string | null;
  vramGb: number | null;
  cudaAvailable: boolean;
  tier: HardwareTier;
  recommendedAsr: "small" | "large-v3-turbo";
  recommendedTranslator: string;
  recommendedChunkMs: number;
}

export interface OverlayPayload {
  caption: CaptionResult | null;
  settings: AppSettings;
  positioning?: boolean;
}

export interface ProcessContext {
  sourceLanguage: string;
  targetLanguage: string;
  sequence: number;
  previousText?: string;
  translate?: boolean;
}

export interface TranslationEngine {
  processAudio(blob: Blob, context: ProcessContext): Promise<CaptionResult | null>;
}
