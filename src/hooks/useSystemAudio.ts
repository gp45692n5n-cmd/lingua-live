import { useCallback, useEffect, useRef, useState } from "react";

interface UseSystemAudioOptions {
  chunkDurationMs: number;
  onChunk: (blob: Blob) => void;
  noAudioMessage?: string;
  captureErrorMessage?: string;
}

export function useSystemAudio({ chunkDurationMs, onChunk, noAudioMessage, captureErrorMessage }: UseSystemAudioOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const onChunkRef = useRef(onChunk);

  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLevel(0);
    setIsCapturing(false);
  }, []);

  const recordNextChunk = useCallback((audioStream: MediaStream) => {
    if (!activeRef.current) return;

    const chunks: BlobPart[] = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(audioStream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size > 0 && activeRef.current) {
        onChunkRef.current(blob);
        recordNextChunk(audioStream);
      }
    };

    recorder.start();
    timerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, chunkDurationMs);
  }, [chunkDurationMs]);

  const start = useCallback(async () => {
    setError(null);

    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      const audioTracks = captured.getAudioTracks();
      if (audioTracks.length === 0) {
        captured.getTracks().forEach((track) => track.stop());
        throw new Error(noAudioMessage ?? "No system audio was captured.");
      }

      captured.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = captured;
      activeRef.current = true;
      setIsCapturing(true);

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(audioStream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!activeRef.current) {
          void audioContext.close();
          return;
        }
        analyser.getByteFrequencyData(samples);
        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        setLevel(Math.min(1, average / 96));
        animationRef.current = window.requestAnimationFrame(updateLevel);
      };

      updateLevel();
      recordNextChunk(audioStream);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : captureErrorMessage ?? "Could not capture system audio";
      setError(message);
      stop();
    }
  }, [captureErrorMessage, noAudioMessage, recordNextChunk, stop]);

  useEffect(() => stop, [stop]);

  return { isCapturing, level, error, start, stop };
}
