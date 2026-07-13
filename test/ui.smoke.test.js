// @vitest-environment happy-dom
// UI配線のスモークテスト: index.html の DOM に対して main.js が
// エラーなく初期化され、タブ切り替えが機能することを確認する。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// happy-dom 環境では URL がブラウザ実装に置き換わるため、cwd 基準で読む
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

beforeAll(async () => {
  // index.html の <body> 内容を移植（script タグは除く）
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
  await import('../src/main.js');
});

describe('UI初期化', () => {
  it('計測画面が初期表示される', () => {
    expect(document.getElementById('view-capture').hidden).toBe(false);
    expect(document.getElementById('view-history').hidden).toBe(true);
  });

  it('7項目のチップが表示される', () => {
    const chips = document.querySelectorAll('#metric-chips .chip');
    expect(chips.length).toBe(7);
    expect(chips[0].textContent).toBe('体重');
  });

  it('カメラ非対応環境ではエラーメッセージが出る（クラッシュしない）', () => {
    const status = document.getElementById('capture-status').textContent;
    expect(status).toContain('カメラ');
  });

  it('情報タブにプライバシー方針が表示される', () => {
    document.querySelector('.tab[data-view="view-about"]').click();
    const about = document.getElementById('view-about');
    expect(about.hidden).toBe(false);
    expect(about.textContent).toContain('保存・収集していません');
    expect(about.textContent).toContain('トラフィックも見ていません');
    document.querySelector('.tab[data-view="view-capture"]').click();
  });

  it('取り込みタブに切り替えられる', () => {
    document.querySelector('.tab[data-view="view-import"]').click();
    expect(document.getElementById('view-import').hidden).toBe(false);
    expect(document.getElementById('view-capture').hidden).toBe(true);
    // 計測タブへ戻す
    document.querySelector('.tab[data-view="view-capture"]').click();
    expect(document.getElementById('view-capture').hidden).toBe(false);
  });
});
