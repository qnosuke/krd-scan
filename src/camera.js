// カメラ制御とフレーム取得。

let currentStream = null;

/** 背面カメラを起動して video 要素に接続する */
export async function startCamera(videoEl) {
  stopCamera();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  currentStream = stream;
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCamera() {
  if (currentStream) {
    for (const track of currentStream.getTracks()) track.stop();
    currentStream = null;
  }
}

/**
 * ガイド枠（画面座標）に対応する映像内の領域を ImageData として切り出す。
 * video は object-fit: cover で表示されている前提で座標変換する。
 *
 * @param {HTMLVideoElement} videoEl
 * @param {DOMRect} containerRect カメラ表示領域の getBoundingClientRect()
 * @param {DOMRect} guideRect ガイド枠の getBoundingClientRect()
 * @param {HTMLCanvasElement} canvas 作業用キャンバス（使い回す）
 * @returns {ImageData|null}
 */
export function grabGuideROI(videoEl, containerRect, guideRect, canvas) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return null;

  const cw = containerRect.width;
  const ch = containerRect.height;
  const scale = Math.max(cw / vw, ch / vh); // cover
  const offsetX = (vw * scale - cw) / 2;
  const offsetY = (vh * scale - ch) / 2;

  // ガイド枠 → 映像ピクセル座標
  const gx = (guideRect.left - containerRect.left + offsetX) / scale;
  const gy = (guideRect.top - containerRect.top + offsetY) / scale;
  const gw = guideRect.width / scale;
  const gh = guideRect.height / scale;

  const sx = Math.max(0, Math.round(gx));
  const sy = Math.max(0, Math.round(gy));
  const sw = Math.min(vw - sx, Math.round(gw));
  const sh = Math.min(vh - sy, Math.round(gh));
  if (sw < 10 || sh < 10) return null;

  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh);
}
