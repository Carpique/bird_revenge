/**
 * Starts the camera into `video`. `onEnded` fires if the stream dies on its own (laptop sleep, camera
 * unplugged or taken by another app) — not when `stopCamera` stops it.
 */
export async function startCamera(video: HTMLVideoElement, onEnded?: () => void): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available (the page must be served from localhost or https).');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
  });
  video.srcObject = stream;
  try {
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) resolve();
      else video.onloadedmetadata = () => resolve();
    });
    await video.play();
  } catch (e) {
    stopCamera(video);
    throw e;
  }
  if (onEnded) {
    for (const t of stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        if (video.srcObject === stream) onEnded();
      });
    }
  }
}

/** Stops the camera (its light goes off); `startCamera` turns it back on. */
export function stopCamera(video: HTMLVideoElement) {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
