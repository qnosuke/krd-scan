# CSVインポート機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自アプリが書き出したCSVを履歴タブから読み戻し、重複（分単位日時キー）をスキップして記録を復元できるようにする。

**Architecture:** DOM/DBに触れない純関数パーサ `src/csvImport.js`（全か無かの検証・重複除外）＋ `db.js` の1トランザクション一括挿入 `addMeasurements` ＋ `historyView.js` は配線のみ。エクスポート側 `csv.js` の `HEADER`/`formatDate` をexport化して往復整合の単一情報源にする。

**Tech Stack:** Vanilla JS + Vite、vitest（純関数は node 環境、UIスモークは happy-dom）。依存ライブラリ追加なし。

## Global Constraints

- IndexedDB名 `karadascan`・スキーマ・`DB_VERSION = 1` は変更しない
- 測定データは端末内のみ・外部送信なし・解析なし（CSVは `file.text()` でローカル処理のみ）
- 依存ライブラリを追加しない
- `src/sevenseg.js`・`src/session.js` に触れない
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- main ブランチで直接作業（push = 自動デプロイなので、pushはTask 4まで行わない）
- 仕様書: `docs/superpowers/specs/2026-07-16-csv-import-design.md`

---

### Task 1: csvImport.js 純関数（パース・検証・重複除外）

**Files:**
- Modify: `src/csv.js`（`HEADER` と `formatDate` を export 化。3行目と5行目）
- Create: `src/csvImport.js`
- Test: `test/csvImport.test.js`

**Interfaces:**
- Consumes: `csv.js` の `toCsv(records)`・`HEADER: string[]`・`formatDate(iso): 'YYYY-MM-DD HH:MM'`、`metrics.js` の `METRICS`・`validateInput(text, metric)`
- Produces: `parseCsvText(text) → { ok:true, records:[{measuredAt, weight, bodyFat, visceralFat, skeletalMuscle, bodyAge, basalMetabolism, bmi}] } | { ok:false, error:{ line:number, reason:string } }`（line は1始まり・ヘッダー行=1、値は文字列・未計測は null、measuredAt はISO文字列）／ `dedupeByDateKey(records, existingRecords) → { fresh: record[], skipped: number }`

- [ ] **Step 1: csv.js の HEADER / formatDate を export 化**

`src/csv.js` の該当2箇所に `export` を付ける（他は変更しない）:

```js
export const HEADER = ['日時', ...METRICS.map((m) => (m.unit ? `${m.label}(${m.unit})` : m.label))];
```

```js
export function formatDate(iso) {
```

- [ ] **Step 2: 失敗するテストを書く**

`test/csvImport.test.js` を作成:

```js
import { describe, it, expect } from 'vitest';
import { parseCsvText, dedupeByDateKey } from '../src/csvImport.js';
import { toCsv, formatDate, HEADER } from '../src/csv.js';

// 全項目そろった1レコード（値はDBと同じ文字列表現）
const rec = (measuredAt, over = {}) => ({
  measuredAt,
  weight: '63.4',
  bodyFat: '22.9',
  visceralFat: '8',
  skeletalMuscle: '34.3',
  bodyAge: '42',
  basalMetabolism: '1507',
  bmi: '22.4',
  ...over,
});

const HEADER_LINE = HEADER.join(',');

describe('parseCsvText 正常系', () => {
  it('往復: toCsv の出力を読み戻すと値と分単位日時が一致する', () => {
    const original = [
      rec('2026-07-15T08:30:45.000Z'),
      rec('2026-07-14T08:31:12.000Z', { weight: '63.9', visceralFat: null }),
    ];
    const result = parseCsvText(toCsv(original));
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(2);
    // toCsv は古い順に並べ替えるので [0] が 07-14
    expect(result.records[0].weight).toBe('63.9');
    expect(result.records[0].visceralFat).toBeNull();
    expect(result.records[1].weight).toBe('63.4');
    expect(result.records[1].bmi).toBe('22.4');
    // 分単位の日時キーが往復で保存される
    expect(formatDate(result.records[1].measuredAt)).toBe(formatDate(original[0].measuredAt));
  });

  it('BOMつき・LF改行・末尾空行を受け付ける', () => {
    const text = '\uFEFF' + HEADER_LINE + '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4\n\n';
    const result = parseCsvText(text);
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(formatDate(result.records[0].measuredAt)).toBe('2026-07-15 08:30');
  });

  it('空セルは null（未計測）になる', () => {
    const text = HEADER_LINE + '\r\n2026-07-15 08:30,63.4,,,,,,';
    const result = parseCsvText(text);
    expect(result.ok).toBe(true);
    expect(result.records[0].weight).toBe('63.4');
    expect(result.records[0].bodyFat).toBeNull();
    expect(result.records[0].bmi).toBeNull();
  });

  it('データ行ゼロ（ヘッダーのみ）は ok で records 空', () => {
    const result = parseCsvText(HEADER_LINE + '\r\n');
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(0);
  });
});

describe('parseCsvText 異常系（全か無か）', () => {
  it('空ファイルはエラー', () => {
    const result = parseCsvText('');
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(1);
  });

  it('ヘッダー不一致は「このアプリのCSVではない」', () => {
    const result = parseCsvText('date,weight\n2026-07-15 08:30,63.4');
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(1);
    expect(result.error.reason).toContain('このアプリ');
  });

  it('列数不足は行番号つきエラー', () => {
    const text = HEADER_LINE + '\n2026-07-15 08:30,63.4,22.9';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
    expect(result.error.reason).toContain('列');
  });

  it('日時の形式不正は行番号つきエラー', () => {
    const text = HEADER_LINE + '\n2026/07/15 08:30,63.4,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
    expect(result.error.reason).toContain('日時');
  });

  it('実在しない日時（2026-02-30）はエラー', () => {
    const text = HEADER_LINE + '\n2026-02-30 08:30,63.4,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
  });

  it('範囲外の値（体重999.9）は項目名つきエラー', () => {
    const text = HEADER_LINE + '\n2026-07-15 08:30,999.9,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(2);
    expect(result.error.reason).toContain('体重');
  });

  it('2行目が正常でも3行目が不正なら全体エラー', () => {
    const text =
      HEADER_LINE +
      '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4' +
      '\n2026-07-16 08:30,abc,22.9,8,34.3,42,1507,22.4';
    const result = parseCsvText(text);
    expect(result.ok).toBe(false);
    expect(result.error.line).toBe(3);
  });
});

describe('dedupeByDateKey', () => {
  it('既存と分単位で同日時の行はスキップされる', () => {
    // 既存はISO秒つき、CSV由来は分単位 → キー正規化で一致すること
    const existing = [rec('2026-07-15T08:30:45.000Z')];
    const parsed = parseCsvText(toCsv(existing));
    const { fresh, skipped } = dedupeByDateKey(parsed.records, existing);
    expect(fresh).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('新規の行だけが fresh に残る', () => {
    const existing = [rec('2026-07-15T08:30:00.000Z')];
    const incoming = parseCsvText(
      toCsv([rec('2026-07-15T08:30:00.000Z'), rec('2026-07-14T08:00:00.000Z')])
    ).records;
    const { fresh, skipped } = dedupeByDateKey(incoming, existing);
    expect(fresh).toHaveLength(1);
    expect(formatDate(fresh[0].measuredAt)).toBe(formatDate('2026-07-14T08:00:00.000Z'));
    expect(skipped).toBe(1);
  });

  it('CSV内部の同日時重複も1件にまとめる', () => {
    const text =
      HEADER_LINE +
      '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4' +
      '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4';
    const { records } = parseCsvText(text);
    const { fresh, skipped } = dedupeByDateKey(records, []);
    expect(fresh).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('既存が空なら全件 fresh', () => {
    const { records } = parseCsvText(
      HEADER_LINE + '\n2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4'
    );
    const { fresh, skipped } = dedupeByDateKey(records, []);
    expect(fresh).toHaveLength(1);
    expect(skipped).toBe(0);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/csvImport.test.js`
Expected: FAIL（`src/csvImport.js` が存在しないため全件エラー）

- [ ] **Step 4: src/csvImport.js を実装**

```js
// CSVインポートの純関数。DOM・IndexedDBに触れない。
// 対象は自アプリ（csv.js toCsv）の書き出し形式のみ。検証は全か無か:
// 1行でも不正があれば何も取り込まず { ok:false, error:{line, reason} } を返す。
import { METRICS, validateInput } from './metrics.js';
import { HEADER, formatDate } from './csv.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * 日時セル（ローカル時刻 'YYYY-MM-DD HH:MM'）→ ISO文字列。
 * 繰り上がり（2026-02-30 → 3月2日）を検出して実在しない日時は null。
 */
function parseLocalDate(cell) {
  const [datePart, timePart] = cell.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return null;
  }
  return date.toISOString();
}

/** CSVテキスト → { ok:true, records } | { ok:false, error:{line, reason} }（lineは1始まり） */
export function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (lines.length === 0) {
    return { ok: false, error: { line: 1, reason: 'ファイルが空です' } };
  }
  if (lines[0] !== HEADER.join(',')) {
    return {
      ok: false,
      error: { line: 1, reason: 'このアプリが書き出したCSVではないようです（ヘッダーが一致しません）' },
    };
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = i + 1;
    const cells = lines[i].split(',');
    if (cells.length !== METRICS.length + 1) {
      return { ok: false, error: { line, reason: `列数が${cells.length}です（${METRICS.length + 1}列必要）` } };
    }

    const dateCell = cells[0];
    if (!DATE_RE.test(dateCell)) {
      return { ok: false, error: { line, reason: `日時「${dateCell}」の形式が不正です` } };
    }
    const measuredAt = parseLocalDate(dateCell);
    if (measuredAt === null) {
      return { ok: false, error: { line, reason: `日時「${dateCell}」は実在しない日時です` } };
    }

    const record = { measuredAt };
    for (let j = 0; j < METRICS.length; j++) {
      const m = METRICS[j];
      const value = cells[j + 1];
      if (!validateInput(value, m)) {
        return { ok: false, error: { line, reason: `${m.label}の値「${value}」が不正です` } };
      }
      record[m.key] = value === '' ? null : value;
    }
    records.push(record);
  }
  return { ok: true, records };
}

/**
 * 分単位の日時キー（CSVの日時セル形式 = formatDate）で重複を除外する。
 * 既存レコードの measuredAt は秒つきISOなので、同じ formatDate で
 * 正規化して比較する（読み戻し時の二重登録を防ぐ肝）。
 */
export function dedupeByDateKey(records, existingRecords) {
  const seen = new Set(existingRecords.map((r) => formatDate(r.measuredAt)));
  const fresh = [];
  let skipped = 0;
  for (const r of records) {
    const key = formatDate(r.measuredAt);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key); // CSV内部の同日時重複も1件にまとめる
    fresh.push(r);
  }
  return { fresh, skipped };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run test/csvImport.test.js`
Expected: PASS（15テスト）

Run: `npx vitest run`
Expected: 既存テストも含め全件 PASS（export追加は既存挙動を変えない）

- [ ] **Step 6: コミット**

```bash
git add src/csv.js src/csvImport.js test/csvImport.test.js
git commit -m "CSVインポートのパース・検証・重複除外の純関数を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: db.js に一括挿入 addMeasurements を追加

**Files:**
- Modify: `src/db.js`（`addMeasurement` の直後に追加）

**Interfaces:**
- Consumes: db.js 内部の `openDB()`・`tx(db, mode, fn)`（既存）
- Produces: `addMeasurements(records) → Promise`（1トランザクションで全件 `store.add`。どれかが失敗するとトランザクションごと abort され、部分書き込みは起きない）

**注意:** テスト環境（node / happy-dom）には IndexedDB がない。プロジェクト方針として fake-indexeddb は導入しない（依存追加なしの制約）ため、この関数の単体テストは書かず、Task 4 の実ブラウザ検証で確認する。

- [ ] **Step 1: addMeasurements を実装**

`src/db.js` の `addMeasurement` の直後に追加:

```js
/**
 * 複数レコードを1トランザクションで追加（CSVインポート用）。
 * 途中で失敗した場合はトランザクションごと abort され、部分書き込みは起きない。
 */
export async function addMeasurements(records) {
  const db = await openDB();
  return tx(db, 'readwrite', (store) => {
    for (const r of records) store.add(r);
  });
}
```

- [ ] **Step 2: 全テストが引き続き通ることを確認**

Run: `npx vitest run`
Expected: 全件 PASS

- [ ] **Step 3: コミット**

```bash
git add src/db.js
git commit -m "複数レコードを1トランザクションで追加する addMeasurements を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 履歴タブにインポートUIを配線

**Files:**
- Modify: `index.html`（`view-history` セクションの `.history-actions`）
- Modify: `src/ui/historyView.js`（import文・DOM参照・イベントリスナー追加）
- Test: `test/ui.smoke.test.js`（ボタン存在のスモーク追加）

**Interfaces:**
- Consumes: Task 1 の `parseCsvText(text)`・`dedupeByDateKey(records, existing)`、Task 2 の `addMeasurements(records)`、既存の `listMeasurements()`・`render()`
- Produces: UIのみ（他タスクから参照されるAPIなし）

- [ ] **Step 1: 失敗するスモークテストを書く**

`test/ui.smoke.test.js` の `describe('UI初期化', ...)` 内の末尾にテストを追加:

```js
  it('履歴タブにCSV読み込みボタンとファイル入力がある', () => {
    const btn = document.getElementById('btn-import-csv');
    const input = document.getElementById('import-csv-file');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('CSVを読み込む');
    expect(btn.classList.contains('primary')).toBe(false); // 控えめボタン
    expect(input).not.toBeNull();
    expect(input.accept).toContain('csv');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/ui.smoke.test.js`
Expected: FAIL（`btn` が null）

- [ ] **Step 3: index.html にボタンと hidden input を追加**

`view-history` セクションの `.history-actions` を次のように変更:

```html
      <div class="history-actions">
        <button id="btn-export-csv" class="btn primary">CSVを書き出す</button>
        <button id="btn-import-csv" class="btn">CSVを読み込む</button>
        <input type="file" id="import-csv-file" accept=".csv,text/csv" hidden />
      </div>
```

- [ ] **Step 4: historyView.js に配線を追加**

import文を変更（2箇所）:

```js
import { listMeasurements, deleteMeasurement, addMeasurements } from '../db.js';
```

`import { buildChart, ... }` 行の後に追加:

```js
import { parseCsvText, dedupeByDateKey } from '../csvImport.js';
```

DOM参照（`const btnExport = ...` の直後）に追加:

```js
  const btnImport = document.getElementById('btn-import-csv');
  const importFileEl = document.getElementById('import-csv-file');
```

`btnExport.addEventListener(...)` の直後にリスナーを追加:

```js
  btnImport.addEventListener('click', () => importFileEl.click());

  importFileEl.addEventListener('change', async () => {
    const file = importFileEl.files?.[0];
    importFileEl.value = ''; // 同じファイルをもう一度選べるようにする
    if (!file) return;

    const parsed = parseCsvText(await file.text());
    if (!parsed.ok) {
      alert(`読み込めませんでした。\n${parsed.error.line}行目: ${parsed.error.reason}`);
      return;
    }
    if (parsed.records.length === 0) {
      alert('取り込める記録がありませんでした');
      return;
    }

    const existing = await listMeasurements();
    const { fresh, skipped } = dedupeByDateKey(parsed.records, existing);
    if (fresh.length === 0) {
      alert(`すべて登録済みでした（${skipped}件重複）`);
      return;
    }

    const msg =
      skipped > 0
        ? `${fresh.length}件を追加します（${skipped}件は登録済みのためスキップ）。よろしいですか？`
        : `${fresh.length}件を追加します。よろしいですか？`;
    if (!confirm(msg)) return;

    try {
      await addMeasurements(fresh);
    } catch {
      // 1トランザクションなので部分書き込みは起きていない
      alert('保存に失敗しました。もう一度お試しください');
      return;
    }
    await render();
    alert(`${fresh.length}件を追加しました`);
  });
```

- [ ] **Step 5: 全テストが通ることを確認**

Run: `npx vitest run`
Expected: 全件 PASS（スモーク追加分含む）

- [ ] **Step 6: コミット**

```bash
git add index.html src/ui/historyView.js test/ui.smoke.test.js
git commit -m "履歴タブにCSV読み込みボタンを追加しインポートを配線

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 総合検証とデプロイ

**Files:**
- なし（検証・デプロイ・メモリ更新のみ）

**Interfaces:**
- Consumes: Task 1〜3 のすべて
- Produces: 本番デプロイ

- [ ] **Step 1: 全テストとビルド**

Run: `npx vitest run && npm run build`
Expected: 全テスト PASS、`dist/sw.js` 生成まで成功

- [ ] **Step 2: 実ブラウザで往復確認**

開発サーバー（`npm run dev`）+ ブラウザ自動化で確認する。テスト用CSVはスクラッチパッドに作成し、**リポジトリにはコミットしない**:

1. IndexedDBに2件シード（既存手順どおり `indexedDB` 直接操作。DB名 `karadascan`、ストア `measurements`）
2. 履歴タブで2件表示を確認
3. テストCSV（シード2件と同日時の2行 + 新規日時の2行）をファイル入力に渡す
4. confirm に「2件を追加します（2件は登録済みのためスキップ）」が出ること
5. OK後、履歴が4件になり最新値サマリー・グラフが更新されること
6. 壊れたCSV（ヘッダー改変）で「このアプリが書き出したCSVではないようです」が出て履歴が変わらないこと
7. 検証後 `indexedDB.deleteDatabase('karadascan')` でテストデータを削除

- [ ] **Step 3: push とデプロイ確認**

```bash
git push origin main
gh run list --repo qnosuke/krd-scan --limit 1
```

デプロイ完了後:

```bash
curl -s https://qnosuke.github.io/krd-scan/ | shasum
shasum dist/index.html
```

Expected: 2つのハッシュが一致

- [ ] **Step 4: メモリ更新**

`~/.claude/projects/-Users-adlibmacmini2021-Documents-project-karadascan/memory/karadascan-project-state.md` の「次にユーザーが希望: データのインポート機能」の行を実装完了の記録に書き換え、`MEMORY.md` のインデックス行も更新する。
