import { useEffect, useMemo, useState } from "react";
import { defaultSettings } from "./config";
import { translate } from "./i18n";
import type { OverlayPayload } from "./types";

const initialPayload: OverlayPayload = {
  caption: {
    id: "preview",
    sourceText: "Real-time captions appear here",
    translatedText: "Translated captions appear here",
    detectedLanguage: "English",
    confidence: 1,
    timestamp: Date.now(),
    isDemo: true,
  },
  settings: defaultSettings,
};

function colorWithOpacity(hex: string, opacity: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export function Overlay() {
  const [payload, setPayload] = useState(initialPayload);

  useEffect(() => {
    const unsubscribe = window.desktopAPI?.onOverlayPayload(setPayload);
    return () => {
      unsubscribe?.();
    };
  }, []);

  const style = payload.settings.subtitleStyle;
  const t = (key: Parameters<typeof translate>[1]) => translate(payload.settings.uiLocale, key);
  const showSource = style.displayMode !== "translation";
  const showTranslation = style.displayMode !== "source";
  const outline = useMemo(
    () => `${style.outlineWidth}px ${style.outlineWidth}px 0 ${style.outlineColor}, -${style.outlineWidth}px -${style.outlineWidth}px 0 ${style.outlineColor}, ${style.outlineWidth}px -${style.outlineWidth}px 0 ${style.outlineColor}, -${style.outlineWidth}px ${style.outlineWidth}px 0 ${style.outlineColor}`,
    [style.outlineColor, style.outlineWidth],
  );

  const caption = payload.caption ?? (payload.positioning ? initialPayload.caption : null);
  if (!caption) return null;

  return (
    <main className={`overlay-stage overlay-stage--${style.position} ${payload.positioning ? "overlay-stage--positioning" : ""}`}>
      {payload.positioning && <div className="overlay-position-hint">{t("overlayPositionHint")}</div>}
      <div
        className="overlay-caption"
        style={{
          backgroundColor: style.backgroundOpacity > 0 ? colorWithOpacity(style.backgroundColor, style.backgroundOpacity) : "transparent",
          fontFamily: style.fontFamily,
          fontSize: `${style.fontSize}px`,
        }}
      >
        {showSource && (
          <div className="overlay-source" style={{ color: style.textColor, textShadow: outline }}>
            {caption.sourceText}
          </div>
        )}
        {showTranslation && (
          <div className="overlay-translation" style={{ color: style.translationColor, textShadow: outline }}>
            {caption.translatedText}
          </div>
        )}
      </div>
    </main>
  );
}
