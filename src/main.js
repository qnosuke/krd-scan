import { createCaptureView } from './ui/captureView.js';
import { createConfirmView } from './ui/confirmView.js';
import { createHistoryView } from './ui/historyView.js';
import { createImportView } from './ui/importView.js';

// Service Worker 登録（vite-plugin-pwa。dev では no-op）
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

const views = {};
let activeView = null;

function switchView(id, ...args) {
  for (const [viewId, view] of Object.entries(views)) {
    const el = document.getElementById(viewId);
    if (viewId === id) {
      el.hidden = false;
      view.show(...args);
    } else {
      if (activeView === viewId) view.hide();
      el.hidden = true;
    }
  }
  activeView = id;
  // タブの選択状態（確認画面は計測タブ扱い）
  const tabView = id === 'view-confirm' ? 'view-capture' : id;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === tabView);
  });
}

views['view-capture'] = createCaptureView({
  onDone: (results) => switchView('view-confirm', results),
});
views['view-confirm'] = createConfirmView({
  onSaved: () => switchView('view-history'),
  onDiscarded: () => switchView('view-capture'),
});
views['view-history'] = createHistoryView();
views['view-import'] = createImportView({
  onDone: (results) => switchView('view-confirm', results),
});
views['view-about'] = { show() {}, hide() {} }; // 静的ページ

// カメラが使えない場面用: 確認画面を手入力モードで開く
document.getElementById('btn-manual-entry').addEventListener('click', () => {
  switchView('view-confirm', {}, { manual: true });
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

switchView('view-capture');
