import { defaultSettings } from "../config";
import type { AppSettings, SubtitleDisplayMode, SubtitleStyle, UiLocale } from "../types";

const storageKey = "lingua-live:settings:v8";
const modernLegacyKeys = ["lingua-live:settings:v7", "lingua-live:settings:v6"];
const olderLegacyKeys = ["lingua-live:settings:v5", "lingua-live:settings:v4", "lingua-live:settings:v3"];

type LegacySubtitleStyle = Partial<SubtitleStyle> & {
  showSource?: boolean;
  showTranslation?: boolean;
};

function getDisplayMode(style: LegacySubtitleStyle | undefined): SubtitleDisplayMode {
  if (style?.displayMode) return style.displayMode;
  if (style?.showSource && style?.showTranslation) return "bilingual";
  if (style?.showSource) return "source";
  return "translation";
}

function detectUiLocale(): UiLocale {
  const language = window.navigator.language.toLowerCase();
  if (language.startsWith("zh")) return "zh-CN";
  if (language.startsWith("ja")) return "ja";
  if (language.startsWith("ko")) return "ko";
  if (language.startsWith("fr")) return "fr";
  if (language.startsWith("de")) return "de";
  return "en";
}

export function loadSettings(): AppSettings {
  try {
    const currentSaved = window.localStorage.getItem(storageKey);
    const modernSaved = modernLegacyKeys.map((key) => window.localStorage.getItem(key)).find(Boolean);
    const saved = currentSaved
      ?? modernSaved
      ?? olderLegacyKeys.map((key) => window.localStorage.getItem(key)).find(Boolean);
    if (!saved) return { ...defaultSettings, uiLocale: detectUiLocale() };

    const parsed = JSON.parse(saved) as Partial<AppSettings>;
    const savedStyle = parsed.subtitleStyle as LegacySubtitleStyle | undefined;
    const preservesModernSettings = Boolean(currentSaved || modernSaved);
    const migratedEngine = preservesModernSettings ? parsed.engine : "local";
    return {
      ...defaultSettings,
      ...parsed,
      uiLocale: parsed.uiLocale ?? detectUiLocale(),
      engine: migratedEngine ?? defaultSettings.engine,
      chunkDurationMs: preservesModernSettings ? parsed.chunkDurationMs ?? defaultSettings.chunkDurationMs : 1500,
      subtitleStyle: {
        ...defaultSettings.subtitleStyle,
        ...savedStyle,
        displayMode: getDisplayMode(savedStyle),
      },
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}
