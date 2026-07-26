import type { AppSettings, LanguageOption } from "./types";

export const sourceLanguages: LanguageOption[] = [
  { id: "auto", label: "自动识别", shortLabel: "AUTO" },
  { id: "zh", label: "普通话", shortLabel: "中" },
  { id: "yue", label: "粤语", shortLabel: "粤" },
  { id: "zh-sichuan", label: "四川话", shortLabel: "川" },
  { id: "ja", label: "日语", shortLabel: "日" },
  { id: "en", label: "英语", shortLabel: "EN" },
  { id: "ko", label: "韩语", shortLabel: "한" },
  { id: "fr", label: "法语", shortLabel: "FR" },
  { id: "de", label: "德语", shortLabel: "DE" },
];

export const targetLanguages: LanguageOption[] = [
  { id: "zh", label: "简体中文", shortLabel: "中" },
  { id: "en", label: "英语", shortLabel: "EN" },
  { id: "ja", label: "日语", shortLabel: "日" },
  { id: "ko", label: "韩语", shortLabel: "한" },
  { id: "fr", label: "法语", shortLabel: "FR" },
  { id: "de", label: "德语", shortLabel: "DE" },
];

export const fontOptions = [
  { value: "system-ui", label: "跟随系统" },
  { value: "Microsoft YaHei, sans-serif", label: "微软雅黑" },
  { value: "Noto Sans SC, sans-serif", label: "Noto Sans SC" },
  { value: "Noto Sans JP, sans-serif", label: "Noto Sans JP" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
];

export const defaultSettings: AppSettings = {
  uiLocale: "en",
  engine: "local",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  endpoint: "http://127.0.0.1:8787/v1/caption",
  apiKey: "",
  chunkDurationMs: 1500,
  overlayVisible: false,
  overlayBounds: null,
  subtitleStyle: {
    fontFamily: "system-ui",
    fontSize: 34,
    textColor: "#ffffff",
    translationColor: "#ffd85a",
    outlineColor: "#111111",
    outlineWidth: 2,
    backgroundColor: "#111111",
    backgroundOpacity: 0,
    position: "bottom",
    displayMode: "bilingual",
  },
};

export const colorSwatches = ["#ffffff", "#ffd85a", "#64d7ff", "#8cf0b4", "#ff9b8f"];
