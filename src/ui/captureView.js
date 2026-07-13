import { METRICS } from '../metrics.js';
import { CaptureSession } from '../session.js';
import { recognizeFrame } from '../sevenseg.js';
import { startCamera, stopCamera, grabGuideROI } from '../camera.js';

const INTERVAL_MS = 100; // 約10fpsで認識

export function createCaptureView({ onDone }) {
  const videoEl = document.getElementById('camera-video');
  const guideEl = document.getElementById('guide-frame');
  const statusEl = document.getElementById('capture-status');
  const chipsEl = document.getElementById('metric-chips');
  const btnStart = document.getElementById('btn-capture-start');
  const btnFinish = document.getElementById('btn-capture-finish');
  const workCanvas = document.createElement('canvas');

  let session = null;
  let timer = null;

  function renderChips(results) {
    chipsEl.innerHTML = '';
    for (const m of METRICS) {
      const chip = document.createElement('span');
      const value = results?.[m.key];
      chip.className = 'chip' + (value ? ' done' : '');
      chip.textContent = value ? `${m.label} ${value}` : m.label;
      chipsEl.appendChild(chip);
    }
  }

  function stopLoop() {
    if (timer) clearInterval(timer);
    timer = null;
    btnStart.hidden = false;
    btnFinish.hidden = true;
  }

  function finish() {
    const results = session ? session.getResults() : {};
    stopLoop();
    session = null;
    onDone(results);
  }

  function tick() {
    const container = videoEl.getBoundingClientRect();
    const guide = guideEl.getBoundingClientRect();
    const roi = grabGuideROI(videoEl, container, guide, workCanvas);
    if (!roi) return;
    const { text } = recognizeFrame(roi);
    const { captured, complete } = session.feed(text);
    if (text) statusEl.textContent = `読み取り中: ${text}`;
    if (captured) renderChips(session.getResults());
    if (complete) {
      statusEl.textContent = '7項目すべて読み取りました';
      if (navigator.vibrate) navigator.vibrate(200);
      finish();
    }
  }

  btnStart.addEventListener('click', () => {
    session = new CaptureSession({ stableFrames: 3 });
    renderChips({});
    statusEl.textContent = '数字を枠に合わせてください';
    btnStart.hidden = true;
    btnFinish.hidden = false;
    timer = setInterval(tick, INTERVAL_MS);
  });

  btnFinish.addEventListener('click', finish);

  return {
    async show() {
      renderChips({});
      try {
        await startCamera(videoEl);
        statusEl.textContent = '「読み取り開始」を押して計測してください';
      } catch (e) {
        statusEl.textContent = 'カメラを起動できません。Safariの設定でカメラを許可してください';
        console.error(e);
      }
    },
    hide() {
      stopLoop();
      session = null;
      stopCamera();
    },
  };
}
