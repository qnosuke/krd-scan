import { METRICS, matchesMetric } from '../metrics.js';
import { CaptureSession } from '../session.js';
import { recognizeFrame } from '../sevenseg.js';

// 動画をこの間隔でシークしながら読み取る
const STEP_SEC = 0.15;

export function createImportView({ onDone }) {
  const fileInput = document.getElementById('import-file');
  const videoEl = document.getElementById('import-video');
  const canvasEl = document.getElementById('import-canvas');
  const statusEl = document.getElementById('import-status');
  const chipsEl = document.getElementById('import-chips');
  const btnRun = document.getElementById('btn-import-run');
  const btnConfirm = document.getElementById('btn-import-confirm');

  let objectUrl = null;
  let results = null;
  let running = false;

  function renderChips(res) {
    chipsEl.innerHTML = '';
    for (const m of METRICS) {
      const chip = document.createElement('span');
      const value = res?.[m.key];
      chip.className = 'chip' + (value ? ' done' : '');
      chip.textContent = value ? `${m.label} ${value}` : m.label;
      chipsEl.appendChild(chip);
    }
  }

  function frameImageData() {
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return null;
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function processFrame(session, mediaTime, duration) {
    const img = frameImageData();
    if (!img) return;
    const { text } = recognizeFrame(img);
    const { captured } = session.feed(text);
    if (import.meta.env.DEV && text != null) {
      console.debug(`[import] t=${mediaTime.toFixed(2)} read=${text}${captured ? ` 確定:${captured}` : ''}`);
    }
    if (captured) renderChips(session.getResults());
    statusEl.textContent = `解析中… ${Math.round((mediaTime / duration) * 100)}%`;
    // 7項目そろっても最後まで処理する: 表示周回が繰り返されるので
    // 票を集めるほど多数決（誤読の上書き）が効く
  }

  /**
   * 再生しながら「実際に提示されたフレーム」だけを読む。
   * iOS Safari はシーク(currentTime代入)だと seeked 発火時点で
   * 古いフレームが canvas に描かれることがあり、重複フレームが
   * 誤読を「2フレーム連続」で確定させてしまう。
   * requestVideoFrameCallback は提示済みフレームごとに呼ばれるため
   * この問題が起きない。
   */
  function runVideoPlayback(session) {
    return new Promise((resolve) => {
      let lastSampled = -Infinity;
      const onFrame = (_now, meta) => {
        if (!running) return resolve();
        if (meta.mediaTime - lastSampled >= STEP_SEC) {
          lastSampled = meta.mediaTime;
          processFrame(session, meta.mediaTime, videoEl.duration);
        }
        videoEl.requestVideoFrameCallback(onFrame);
      };
      videoEl.onended = () => resolve();
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.currentTime = 0;
      videoEl.requestVideoFrameCallback(onFrame);
      videoEl.play().catch(() => resolve());
    });
  }

  /** requestVideoFrameCallback 非対応環境向け: シークしながら読む */
  async function runVideoSeek(session) {
    const seekTo = (t) =>
      new Promise((resolve) => {
        videoEl.onseeked = () => resolve();
        videoEl.currentTime = t;
      });
    const duration = videoEl.duration;
    for (let t = 0; t < duration && running; t += STEP_SEC) {
      await seekTo(t);
      processFrame(session, t, duration);
    }
  }

  async function runVideo() {
    running = true;
    btnRun.hidden = true;
    // 3フレーム(約0.45秒)連続で同じ読みを要求する。1画面は約1秒表示される
    // ので正しい値は確定でき、画面切り替わりのブレによる部分誤読
    // (「36.2」が「6.2」に見える等)は連続しないため弾ける
    const session = new CaptureSession({ stableFrames: 3 });
    renderChips({});
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      await runVideoPlayback(session);
    } else {
      await runVideoSeek(session);
    }
    videoEl.pause();
    running = false;
    results = session.getResults();
    const n = Object.keys(results).length;
    statusEl.textContent = n > 0 ? `${n}項目を読み取りました` : '数値を読み取れませんでした。液晶が大きく鮮明に写っているか確認してください';
    btnConfirm.hidden = n === 0;
    btnRun.hidden = false;
  }

  async function runImage(file) {
    const bitmap = await createImageBitmap(file);
    canvasEl.width = bitmap.width;
    canvasEl.height = bitmap.height;
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    // 静止画は1項目分しか写らないので、レンジ・小数桁が合う最初の項目に割り当てる
    // （セッションの体重アンカーは使わない: 周回がないので回収できない）
    const { text } = recognizeFrame(img);
    const metric = text ? METRICS.find((m) => matchesMetric(text, m)) : null;
    results = metric ? { [metric.key]: text } : {};
    const n = Object.keys(results).length;
    statusEl.textContent =
      n > 0 ? `「${text}」を読み取りました（項目は確認画面で修正できます）` : '数値を読み取れませんでした';
    renderChips(results);
    btnConfirm.hidden = n === 0;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    running = false;
    results = null;
    btnConfirm.hidden = true;
    renderChips({});
    if (objectUrl) URL.revokeObjectURL(objectUrl);

    if (file.type.startsWith('video/')) {
      objectUrl = URL.createObjectURL(file);
      videoEl.src = objectUrl;
      videoEl.hidden = false;
      canvasEl.hidden = true;
      statusEl.textContent = '「読み取り実行」を押してください';
      btnRun.hidden = false;
    } else {
      videoEl.hidden = true;
      canvasEl.hidden = false;
      statusEl.textContent = '解析中…';
      btnRun.hidden = true;
      runImage(file);
    }
  });

  btnRun.addEventListener('click', () => {
    if (!running) runVideo();
  });

  btnConfirm.addEventListener('click', () => {
    if (results) onDone(results);
  });

  return {
    show() {},
    hide() {
      running = false;
    },
  };
}
