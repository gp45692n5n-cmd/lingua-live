import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(currentDir, "..");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendStartPromise: Promise<BackendStatus> | null = null;
let isQuitting = false;

type ModelState = "not_loaded" | "loading" | "ready" | "error";

interface BackendStatus {
  state: "stopped" | "starting" | "ready" | "error";
  message: string;
  model: string;
  modelState: ModelState;
  modelLoaded: boolean;
  modelDownloadProgress: number;
  pid: number | null;
  logs: string[];
}

interface HealthResponse {
  status: string;
  model: string;
  modelState: ModelState;
  modelLoaded: boolean;
  device: string;
  computeType: string;
  modelDownloadProgress?: number;
  modelError?: string | null;
  activeTranslator?: string;
  translatorState?: string;
}

interface HardwareProfile {
  platform: string;
  cpuModel: string;
  cpuThreads: number;
  memoryGb: number;
  gpuName: string | null;
  vramGb: number | null;
  cudaAvailable: boolean;
  tier: "high" | "balanced" | "lightweight";
  recommendedAsr: "small" | "large-v3-turbo";
  recommendedTranslator: string;
  recommendedChunkMs: number;
}

function detectHardwareProfile(): HardwareProfile {
  const cpuThreads = os.cpus().length;
  const memoryGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  let gpuName: string | null = null;
  let vramGb: number | null = null;

  const result = spawnSync(
    "nvidia-smi",
    ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
    { encoding: "utf8", windowsHide: true, timeout: 4_000 },
  );
  const firstGpu = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
  if (firstGpu) {
    const separator = firstGpu.lastIndexOf(",");
    const memoryMb = Number(firstGpu.slice(separator + 1).trim());
    gpuName = firstGpu.slice(0, separator).trim() || null;
    vramGb = Number.isFinite(memoryMb) ? Math.round((memoryMb / 1024) * 10) / 10 : null;
  }

  if (vramGb !== null && vramGb >= 12) {
    return {
      platform: process.platform,
      cpuModel: os.cpus()[0]?.model ?? "Unknown CPU",
      cpuThreads,
      memoryGb,
      gpuName,
      vramGb,
      cudaAvailable: true,
      tier: "high",
      recommendedAsr: "large-v3-turbo",
      recommendedTranslator: "TranslateGemma 4B / Qwen 7B",
      recommendedChunkMs: 1_500,
    };
  }

  if (vramGb !== null && vramGb >= 8) {
    return {
      platform: process.platform,
      cpuModel: os.cpus()[0]?.model ?? "Unknown CPU",
      cpuThreads,
      memoryGb,
      gpuName,
      vramGb,
      cudaAvailable: true,
      tier: "balanced",
      recommendedAsr: "large-v3-turbo",
      recommendedTranslator: "TranslateGemma 4B / Qwen 3B",
      recommendedChunkMs: 1_500,
    };
  }

  return {
    platform: process.platform,
    cpuModel: os.cpus()[0]?.model ?? "Unknown CPU",
    cpuThreads,
    memoryGb,
    gpuName,
    vramGb,
    cudaAvailable: vramGb !== null,
    tier: "lightweight",
    recommendedAsr: "small",
    recommendedTranslator: vramGb !== null ? "Qwen 1.5B / Cloud API" : "Cloud translation API",
    recommendedChunkMs: vramGb !== null ? 2_500 : 4_000,
  };
}

const hardwareProfile = detectHardwareProfile();

let backendStatus: BackendStatus = {
  state: "stopped",
  message: "本地识别服务未启动",
  model: process.env.LINGUA_MODEL ?? hardwareProfile.recommendedAsr,
  modelState: "not_loaded",
  modelLoaded: false,
  modelDownloadProgress: 0,
  pid: null,
  logs: [],
};

function publishBackendStatus(patch: Partial<BackendStatus>) {
  backendStatus = { ...backendStatus, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("backend:status", backendStatus);
  }
}

function appendBackendLog(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return;
  publishBackendStatus({ logs: [...backendStatus.logs, ...lines].slice(-12) });
}

async function getBackendHealth(timeoutMs = 1_500): Promise<HealthResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("http://127.0.0.1:8787/health", { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as HealthResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function statusFromHealth(health: HealthResponse): Partial<BackendStatus> {
  const modelMessage = health.modelState === "loading"
    ? health.modelDownloadProgress && health.modelDownloadProgress < 1
      ? `正在下载 ${health.model} 模型（${Math.round(health.modelDownloadProgress * 100)}%）`
      : `正在加载 ${health.model} 模型`
    : health.modelState === "ready"
      ? `${health.model} 已加载 · ${health.device.toUpperCase()} · ${health.activeTranslator?.startsWith("ollama") ? "本地翻译" : "在线翻译"}`
      : health.modelState === "error"
        ? `模型加载失败：${health.modelError ?? "未知错误"}`
        : `服务已就绪，首次识别时加载 ${health.model} 模型`;
  return {
    state: "ready",
    message: modelMessage,
    model: health.model,
    modelState: health.modelState,
    modelLoaded: health.modelLoaded,
    modelDownloadProgress: health.modelDownloadProgress ?? 0,
  };
}

function findBackendPython() {
  const configured = process.env.LINGUA_PYTHON;
  const candidates = [
    configured,
    process.platform === "win32"
      ? path.join(projectDir, "backend", ".venv", "Scripts", "python.exe")
      : path.join(projectDir, "backend", ".venv", "bin", "python"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function terminateBackendProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  } else {
    child.kill();
  }
}

async function startBackendInternal(): Promise<BackendStatus> {
  const existingHealth = await getBackendHealth();
  if (existingHealth) {
    publishBackendStatus({ ...statusFromHealth(existingHealth), pid: backendProcess?.pid ?? null });
    return backendStatus;
  }

  if (backendProcess && backendProcess.exitCode === null) {
    return backendStatus;
  }

  const python = findBackendPython();
  if (!python) {
    publishBackendStatus({
      state: "error",
      message: "本地识别环境尚未安装，请先运行 backend/setup.ps1",
      pid: null,
    });
    return backendStatus;
  }

  publishBackendStatus({
    state: "starting",
    message: "正在启动本地识别服务",
    modelState: "not_loaded",
    modelLoaded: false,
    modelDownloadProgress: 0,
    logs: [],
  });

  const child = spawn(python, ["-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", "8787"], {
    cwd: projectDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      HF_HUB_DISABLE_XET: "1",
      LINGUA_MODEL: process.env.LINGUA_MODEL ?? hardwareProfile.recommendedAsr,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  backendProcess = child;
  publishBackendStatus({ pid: child.pid ?? null });

  child.stdout?.on("data", (data: Buffer) => appendBackendLog(data.toString("utf8")));
  child.stderr?.on("data", (data: Buffer) => appendBackendLog(data.toString("utf8")));
  child.on("error", (error) => {
    publishBackendStatus({ state: "error", message: `本地服务启动失败：${error.message}`, pid: null });
  });
  child.on("exit", (code) => {
    if (backendProcess === child) backendProcess = null;
    if (!isQuitting) {
      publishBackendStatus({
        state: code === 0 ? "stopped" : "error",
        message: code === 0 ? "本地识别服务已停止" : `本地识别服务异常退出（${code ?? "未知"}）`,
        pid: null,
        modelLoaded: false,
        modelState: "not_loaded",
      });
    }
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    const health = await getBackendHealth();
    if (health) {
      publishBackendStatus({ ...statusFromHealth(health), pid: child.pid ?? null });
      return backendStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  terminateBackendProcess(child);
  publishBackendStatus({ state: "error", message: "本地识别服务启动超时", pid: null });
  return backendStatus;
}

function startBackend() {
  if (!backendStartPromise) {
    backendStartPromise = startBackendInternal().finally(() => {
      backendStartPromise = null;
    });
  }
  return backendStartPromise;
}

async function refreshBackendStatus() {
  const health = await getBackendHealth();
  if (health) publishBackendStatus(statusFromHealth(health));
  return backendStatus;
}

function stopBackend() {
  if (backendProcess) terminateBackendProcess(backendProcess);
  backendProcess = null;
  publishBackendStatus({
    state: "stopped",
    message: "本地识别服务已停止",
    pid: null,
    modelState: "not_loaded",
    modelLoaded: false,
    modelDownloadProgress: 0,
  });
  return backendStatus;
}

function rendererUrl(route = "") {
  if (devServerUrl) {
    return `${devServerUrl}${route}`;
  }

  return `file://${path.join(projectDir, "dist", "index.html")}${route}`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#f5f5f2",
    title: "Lingua Live",
    webPreferences: {
      preload: path.join(projectDir, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadURL(rendererUrl());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const display = screen.getPrimaryDisplay();
  const width = Math.min(1080, Math.round(display.workAreaSize.width * 0.72));

  overlayWindow = new BrowserWindow({
    width,
    height: 190,
    x: Math.round((display.workAreaSize.width - width) / 2),
    y: Math.max(20, display.workAreaSize.height - 240),
    minWidth: 520,
    minHeight: 110,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: true,
    webPreferences: {
      preload: path.join(projectDir, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  void overlayWindow.loadURL(rendererUrl("#/overlay"));
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow.on("move", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("overlay:position", overlayWindow.getBounds());
    }
  });

  return overlayWindow;
}

function configureSystemAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    callback({
      video: sources[0],
      audio: "loopback",
    });
  });
}

if (hasSingleInstanceLock) app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (hasSingleInstanceLock) app.whenReady().then(() => {
  configureSystemAudioCapture();
  createMainWindow();
  createOverlayWindow();
  void startBackend();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (backendProcess) terminateBackendProcess(backendProcess);
});

ipcMain.handle("overlay:set-visible", (_event, visible: boolean) => {
  const window = createOverlayWindow();
  if (visible) {
    window.showInactive();
  } else {
    window.hide();
  }
  return visible;
});

ipcMain.handle("overlay:set-interactive", (_event, interactive: boolean) => {
  const window = createOverlayWindow();
  window.setIgnoreMouseEvents(!interactive, { forward: true });
  window.setFocusable(interactive);
  return interactive;
});

ipcMain.handle("overlay:set-bounds", (_event, bounds: { x: number; y: number; width: number; height: number }) => {
  const window = createOverlayWindow();
  const safeBounds = {
    x: Math.round(Number.isFinite(bounds.x) ? bounds.x : 0),
    y: Math.round(Number.isFinite(bounds.y) ? bounds.y : 0),
    width: Math.max(520, Math.round(Number.isFinite(bounds.width) ? bounds.width : 1080)),
    height: Math.max(110, Math.round(Number.isFinite(bounds.height) ? bounds.height : 190)),
  };
  window.setBounds(safeBounds);
  return safeBounds;
});

ipcMain.on("overlay:update", (_event, payload: unknown) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:payload", payload);
  }
});

ipcMain.handle("app:platform", () => process.platform);
ipcMain.handle("app:hardware-profile", () => hardwareProfile);
ipcMain.handle("backend:start", () => startBackend());
ipcMain.handle("backend:stop", () => stopBackend());
ipcMain.handle("backend:get-status", () => refreshBackendStatus());
