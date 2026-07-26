import type { AppSettings, CaptionResult, ProcessContext, TranslationEngine } from "../types";

const demoLines = [
  {
    sourceText: "When the signal appears, we move together.",
    translations: { zh: "信号出现时，我们一起行动。", ja: "合図が出たら、一緒に動く。", ko: "신호가 오면 함께 움직여.", fr: "Au signal, nous avançons ensemble.", de: "Wenn das Signal kommt, gehen wir gemeinsam los." },
    language: "英语",
  },
  {
    sourceText: "もう一度だけ、私を信じてください。",
    translations: { zh: "请再相信我一次。", en: "Please trust me one more time.", ko: "한 번만 더 저를 믿어 주세요.", fr: "Faites-moi confiance encore une fois.", de: "Vertrau mir bitte noch ein einziges Mal." },
    language: "日语",
  },
  {
    sourceText: "呢件事冇你想象中咁简单。",
    translations: { zh: "这件事没有你想象中那么简单。", en: "This is not as simple as you think.", ja: "これは君が思うほど簡単じゃない。", ko: "이 일은 네 생각만큼 간단하지 않아.", fr: "Ce n'est pas aussi simple que tu le penses.", de: "Das ist nicht so einfach, wie du denkst." },
    language: "粤语",
  },
  {
    sourceText: "우리는 아직 끝나지 않았어.",
    translations: { zh: "我们还没有结束。", en: "We are not finished yet.", ja: "私たちはまだ終わっていない。", fr: "Nous n'avons pas encore terminé.", de: "Wir sind noch nicht fertig." },
    language: "韩语",
  },
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class DemoEngine implements TranslationEngine {
  async processAudio(_blob: Blob, context: ProcessContext): Promise<CaptionResult> {
    const line = demoLines[context.sequence % demoLines.length];
    await new Promise((resolve) => window.setTimeout(resolve, 360));

    return {
      id: makeId(),
      sourceText: line.sourceText,
      translatedText: line.translations[context.targetLanguage as keyof typeof line.translations] ?? line.translations.zh,
      detectedLanguage: line.language,
      confidence: 0.96,
      timestamp: Date.now(),
      isDemo: true,
    };
  }
}

class HttpEngine implements TranslationEngine {
  constructor(private readonly settings: AppSettings) {}

  async processAudio(blob: Blob, context: ProcessContext): Promise<CaptionResult | null> {
    const startedAt = performance.now();
    const formData = new FormData();
    formData.append("audio", blob, `chunk-${context.sequence}.webm`);
    formData.append("sourceLanguage", context.sourceLanguage);
    formData.append("targetLanguage", context.targetLanguage);
    formData.append("previousText", context.previousText ?? "");
    formData.append("translate", String(context.translate ?? true));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.settings.engine === "local" ? 300_000 : 30_000);

    try {
      const response = await fetch(this.settings.endpoint, {
        method: "POST",
        headers: this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : undefined,
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(error?.detail ?? `识别服务返回 ${response.status}`);
      }

      const data = (await response.json()) as Partial<CaptionResult>;
      if (!data.sourceText && !data.translatedText) return null;

      return {
        id: data.id ?? makeId(),
        sourceText: data.sourceText ?? "",
        translatedText: data.translatedText ?? "",
        detectedLanguage: data.detectedLanguage ?? context.sourceLanguage,
        detectedLanguageCode: data.detectedLanguageCode,
        confidence: data.confidence ?? 0,
        timestamp: Date.now(),
        latencyMs: this.settings.chunkDurationMs + Math.round(performance.now() - startedAt),
        recognitionMs: data.recognitionMs,
        translationMs: data.translationMs,
        translationWarning: data.translationWarning,
      };
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        throw new Error(this.settings.engine === "local" ? "本地模型加载或识别超时，请稍后重试" : "识别服务请求超时");
      }
      throw reason;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export function createTranslationEngine(settings: AppSettings): TranslationEngine {
  return settings.engine === "demo" ? new DemoEngine() : new HttpEngine(settings);
}
