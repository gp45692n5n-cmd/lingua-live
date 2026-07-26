/// <reference types="vite/client" />

import type { BackendStatus, HardwareProfile, OverlayBounds, OverlayPayload } from "./types";

declare global {
  interface Window {
    desktopAPI?: {
      getPlatform: () => Promise<string>;
      getHardwareProfile: () => Promise<HardwareProfile>;
      startBackend: () => Promise<BackendStatus>;
      stopBackend: () => Promise<BackendStatus>;
      getBackendStatus: () => Promise<BackendStatus>;
      onBackendStatus: (listener: (status: BackendStatus) => void) => () => void;
      setOverlayVisible: (visible: boolean) => Promise<boolean>;
      setOverlayInteractive: (interactive: boolean) => Promise<boolean>;
      setOverlayBounds: (bounds: OverlayBounds) => Promise<OverlayBounds>;
      updateOverlay: (payload: OverlayPayload) => void;
      onOverlayPayload: (listener: (payload: OverlayPayload) => void) => () => void;
      onOverlayPosition: (listener: (bounds: OverlayBounds) => void) => () => void;
    };
  }
}

export {};
