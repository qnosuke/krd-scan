# 目標設定・日次サマリー・手動入力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KRD scan に「体重・体脂肪率の目標設定と達成表示」「履歴の日次グループ化と今日測定済みフィードバック」「測定記録の手動入力」を追加する。

**Architecture:** 目標は localStorage（純関数 `src/goals.js`）、日次グループ化は純関数 `src/daily.js` に切り出し、UI は既存の `historyView.js` / `confirmView.js` への配線のみ。手動入力は既存の確認画面を「手入力モード」（日時入力欄つき）で開き直す。IndexedDB は一切変更しない。

**Tech Stack:** Vanilla JS + Vite、vitest（純関数は node 環境、UI smoke は happy-dom）。実行時依存ゼロを維持。

**Spec:** `docs/superpowers/specs/2026-07-17-goals-daily-manual-design.md`

## Global Constraints

- IndexedDB は一切変更しない（DB_NAME='karadascan'、DB_VERSION=1、既存レコード完全互換）
- 新しい実行時依存を追加しない
- プライバシー約束（端末内のみ・外部送信なし・解析なし）を維持する
- `src/sevenseg.js`・`src/session.js` には触らない
- localStorage キーは `krdscan-goals`、形式は `{ "weight": "63.0", "bodyFat": "20.0" }`（文字列・未設定はキーなし）
- 達成判定 = 最新値 ≦ 目標値で達成。日次代表値 = その日の最新レコード
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- main ブランチで直接作業。`git push` は Task 5 の検証後のみ
- テスト環境に IndexedDB はない。fake-indexeddb は使用禁止。UI テストは既存の `test/ui.smoke.test.js` パターン（happy-dom、履歴タブはクリックしない — render() が IndexedDB に触るため）に従う

---

### Task 1: goals.js 純関数（目標の保存と達成判定）

**Files:**
- Create: `src/goals.js`
- Test: `test/goals.test.js`

**Interfaces:**
- Consumes: なし（純関数のみ。localStorage は引数注入でテスト可能に）
- Produces（Task 3 が使用）:
  - `GOAL_KEYS: string[]` — `['weight', 'bodyFat']`
  - `loadGoals(storage?) → object` — 例 `{ weight: '63.0' }`。壊れていたら `{}`
  - `saveGoals(goals, storage?) → void` — 空なら localStorage キーごと削除
  - `goalStatus(latestRaw, goalRaw) → { diff: number, achieved: boolean } | null`
  - `formatGoalStatus(status, { unit, decimals }) → string | null` — 例 `'あと 0.4kg'` / `'🎉 達成！（−1.5%）'`

- [ ] **Step 1: 失敗するテストを書く**

`test/goals.test.js` を新規作成（node 環境なので localStorage はフェイクを注入する）:

```js
import { describe, it, expect } from 'vitest';
import { GOAL_KEYS, loadGoals, saveGoals, goalStatus, formatGoalStatus } from '../src/goals.js';

// node 環境には localStorage がないので Map ベースのフェイクを注入する
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

describe('loadGoals / saveGoals', () => {
  it('未保存なら空オブジェクト', () => {
    expect(loadGoals(fakeStorage())).toEqual({});
  });

  it('保存して読み戻せる（文字列のまま）', () => {
    const s = fakeStorage();
    saveGoals({ weight: '63.0', bodyFat: '20.0' }, s);
    expect(loadGoals(s)).toEqual({ weight: '63.0', bodyFat: '20.0' });
  });

  it('片方だけの保存も可', () => {
    const s = fakeStorage();
    saveGoals({ weight: '63.0' }, s);
    expect(loadGoals(s)).toEqual({ weight: '63.0' });
  });

  it('壊れたJSONは空扱い', () => {
    const s = fakeStorage();
    s.setItem('krdscan-goals', '{oops');
    expect(loadGoals(s)).toEqual({});
  });

  it('オブジェクトでないJSON・数値化できない値・知らないキーは捨てる', () => {
    const s = fakeStorage();
    s.setItem('krdscan-goals', '[1,2]');
    expect(loadGoals(s)).toEqual({});
    s.setItem('krdscan-goals', JSON.stringify({ weight: 'abc', bmi: '22', bodyFat: '20.0' }));
    expect(loadGoals(s)).toEqual({ bodyFat: '20.0' });
  });

  it('空オブジェクトの保存はキーごと削除', () => {
    const s = fakeStorage();
    saveGoals({ weight: '63.0' }, s);
    saveGoals({}, s);
    expect(s._map.has('krdscan-goals')).toBe(false);
  });

  it('空文字・nullの項目は保存しない', () => {
    const s = fakeStorage();
    saveGoals({ weight: '', bodyFat: null }, s);
    expect(s._map.has('krdscan-goals')).toBe(false);
  });

  it('storage が例外を投げても落ちない', () => {
    const broken = {
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
      removeItem() { throw new Error('nope'); },
    };
    expect(loadGoals(broken)).toEqual({});
    expect(() => saveGoals({ weight: '63.0' }, broken)).not.toThrow();
  });
});

describe('goalStatus（達成 = 最新値 ≦ 目標値）', () => {
  it('未達: diff が正、achieved false', () => {
    expect(goalStatus('63.4', '63.0')).toEqual({ diff: expect.closeTo(0.4), achieved: false });
  });

  it('達成: diff が負、achieved true', () => {
    expect(goalStatus('20.5', '22.0')).toEqual({ diff: expect.closeTo(-1.5), achieved: true });
  });

  it('同値ちょうどは達成', () => {
    expect(goalStatus('63.0', '63.0')).toEqual({ diff: 0, achieved: true });
  });

  it('数値でも受け付ける（previousValue の戻り値は number）', () => {
    expect(goalStatus(63.4, '63.0')).toEqual({ diff: expect.closeTo(0.4), achieved: false });
  });

  it('どちらかが null・空・非数値なら null', () => {
    expect(goalStatus(null, '63.0')).toBeNull();
    expect(goalStatus('63.4', null)).toBeNull();
    expect(goalStatus('', '63.0')).toBeNull();
    expect(goalStatus('63.4', 'abc')).toBeNull();
  });
});

describe('formatGoalStatus', () => {
  const kg = { unit: 'kg', decimals: 1 };

  it('未達は「あと N」', () => {
    expect(formatGoalStatus({ diff: 0.4, achieved: false }, kg)).toBe('あと 0.4kg');
  });

  it('達成は「🎉 達成！（−N）」', () => {
    expect(formatGoalStatus({ diff: -1.5, achieved: true }, { unit: '%', decimals: 1 })).toBe('🎉 達成！（−1.5%）');
  });

  it('同値達成は「🎉 達成！（±0）」', () => {
    expect(formatGoalStatus({ diff: 0, achieved: true }, kg)).toBe('🎉 達成！（±0）');
  });

  it('丸めてゼロになる差も ±0（浮動小数の揺れを吸収）', () => {
    expect(formatGoalStatus({ diff: -0.04, achieved: true }, kg)).toBe('🎉 達成！（±0）');
  });

  it('null は null', () => {
    expect(formatGoalStatus(null, kg)).toBeNull();
  });
});

describe('GOAL_KEYS', () => {
  it('体重と体脂肪率のみ', () => {
    expect(GOAL_KEYS).toEqual(['weight', 'bodyFat']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/goals.test.js`
Expected: FAIL（`src/goals.js` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/goals.js` を新規作成:

```js
// 目標値（体重・体脂肪率）の保存と達成判定。
// 保存先は localStorage（端末内のみ）。値は DB のレコードと同じく文字列で持つ。

const STORAGE_KEY = 'krdscan-goals';

// 目標を設定できる項目（metrics.js の key）
export const GOAL_KEYS = ['weight', 'bodyFat'];

/** localStorage から目標を読む。未保存・壊れたJSON・不正値は空扱い */
export function loadGoals(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const goals = {};
    for (const key of GOAL_KEYS) {
      const v = parsed[key];
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) goals[key] = v;
    }
    return goals;
  } catch {
    return {};
  }
}

/** 目標を保存。全項目未設定なら localStorage のキーごと削除 */
export function saveGoals(goals, storage = globalThis.localStorage) {
  try {
    const clean = {};
    for (const key of GOAL_KEYS) {
      const v = goals?.[key];
      if (v != null && String(v).trim() !== '') clean[key] = String(v);
    }
    if (Object.keys(clean).length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // プライベートブラウズ等で保存できなくてもアプリは落とさない
  }
}

/**
 * 達成判定（達成 = 最新値 ≦ 目標値）。
 * @param {string|number|null} latestRaw 直近の測定値
 * @param {string|number|null} goalRaw 目標値
 * @returns {{ diff: number, achieved: boolean } | null} diff = 最新値 − 目標値
 */
export function goalStatus(latestRaw, goalRaw) {
  if (latestRaw == null || latestRaw === '' || goalRaw == null || goalRaw === '') return null;
  const latest = Number(latestRaw);
  const goal = Number(goalRaw);
  if (!Number.isFinite(latest) || !Number.isFinite(goal)) return null;
  return { diff: latest - goal, achieved: latest <= goal };
}

/** 目標行の状態表示文字列。status が null なら null（差分表示なし） */
export function formatGoalStatus(status, { unit = '', decimals = 1 } = {}) {
  if (!status) return null;
  const mag = Math.abs(status.diff).toFixed(decimals);
  if (status.achieved) {
    const detail = Number(mag) === 0 ? '±0' : `−${mag}${unit}`;
    return `🎉 達成！（${detail}）`;
  }
  return `あと ${mag}${unit}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/goals.test.js`
Expected: PASS（全件）

- [ ] **Step 5: 全テストを回してコミット**

Run: `npx vitest run`
Expected: 既存テスト含め全件 PASS

```bash
git add src/goals.js test/goals.test.js
git commit -m "目標値の保存と達成判定の純関数 goals.js を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: daily.js 純関数（日次グループ化）

**Files:**
- Create: `src/daily.js`
- Test: `test/daily.test.js`

**Interfaces:**
- Consumes: なし（`listMeasurements()` の戻り値形式 = 新しい順のレコード配列を前提とする）
- Produces（Task 3 が使用）:
  - `dateKeyOf(iso) → 'YYYY-MM-DD' | null` — ローカルタイムゾーンの日付キー
  - `groupByDay(records) → [{ dateKey, records, latest }]` — 新しい日順。`records` はその日の新しい順、`latest` はその日の最新レコード
  - `dailyLatest(records) → record[]` — 1日1レコード（その日の最新）に間引いた配列（新しい順）

- [ ] **Step 1: 失敗するテストを書く**

`test/daily.test.js` を新規作成:

```js
import { describe, it, expect } from 'vitest';
import { dateKeyOf, groupByDay, dailyLatest } from '../src/daily.js';

// listMeasurements() と同じく新しい順で渡す
const rec = (measuredAt, weight) => ({ measuredAt, weight });

describe('dateKeyOf', () => {
  it('ISO文字列をローカル日付キーにする', () => {
    // ローカルタイムゾーン依存を避けるためローカル時刻表記で検証
    expect(dateKeyOf('2026-07-17T07:30:00')).toBe('2026-07-17');
  });

  it('不正な日時は null', () => {
    expect(dateKeyOf('not-a-date')).toBeNull();
  });
});

describe('groupByDay', () => {
  it('同じ日の複数測定を1グループにまとめ、latest はその日の最新', () => {
    const records = [
      rec('2026-07-17T21:00:00', '63.4'),
      rec('2026-07-17T07:30:00', '64.0'),
      rec('2026-07-16T07:30:00', '63.8'),
    ];
    const groups = groupByDay(records);
    expect(groups.length).toBe(2);
    expect(groups[0].dateKey).toBe('2026-07-17');
    expect(groups[0].records.length).toBe(2);
    expect(groups[0].latest.weight).toBe('63.4');
    expect(groups[1].dateKey).toBe('2026-07-16');
    expect(groups[1].records.length).toBe(1);
  });

  it('新しい日順で返す', () => {
    const records = [rec('2026-07-17T08:00:00', '63.4'), rec('2026-07-15T08:00:00', '64.0')];
    expect(groupByDay(records).map((g) => g.dateKey)).toEqual(['2026-07-17', '2026-07-15']);
  });

  it('不正な日時のレコードは無視する', () => {
    const records = [rec('2026-07-17T08:00:00', '63.4'), rec('broken', '99')];
    const groups = groupByDay(records);
    expect(groups.length).toBe(1);
    expect(groups[0].records.length).toBe(1);
  });

  it('空・null は空配列', () => {
    expect(groupByDay([])).toEqual([]);
    expect(groupByDay(null)).toEqual([]);
  });
});

describe('dailyLatest', () => {
  it('1日1レコード（その日の最新）に間引く', () => {
    const records = [
      rec('2026-07-17T21:00:00', '63.4'),
      rec('2026-07-17T07:30:00', '64.0'),
      rec('2026-07-16T07:30:00', '63.8'),
    ];
    const latest = dailyLatest(records);
    expect(latest.length).toBe(2);
    expect(latest[0].weight).toBe('63.4');
    expect(latest[1].weight).toBe('63.8');
  });

  it('空なら空配列', () => {
    expect(dailyLatest([])).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/daily.test.js`
Expected: FAIL（`src/daily.js` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/daily.js` を新規作成:

```js
// 日次サマリーの純関数。records は db.js listMeasurements() の戻り値（新しい順）を前提とする。

/** ISO文字列 → ローカルタイムゾーンの日付キー 'YYYY-MM-DD'。不正なら null */
export function dateKeyOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 日付ごとにグループ化する。入力が新しい順なので、グループも新しい日順・
 * グループ内も新しい順になり、各グループの先頭がその日の最新（= 日次代表値）。
 * @returns {Array<{ dateKey: string, records: object[], latest: object }>}
 */
export function groupByDay(records) {
  const groups = [];
  const byKey = new Map();
  for (const r of records ?? []) {
    const key = dateKeyOf(r.measuredAt);
    if (key == null) continue;
    let g = byKey.get(key);
    if (!g) {
      g = { dateKey: key, records: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.records.push(r);
  }
  for (const g of groups) g.latest = g.records[0];
  return groups;
}

/** 1日1レコード（その日の最新）に間引く（推移グラフ用）。新しい順を保つ */
export function dailyLatest(records) {
  return groupByDay(records).map((g) => g.latest);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/daily.test.js`
Expected: PASS（全件）

- [ ] **Step 5: 全テストを回してコミット**

Run: `npx vitest run`
Expected: 全件 PASS

```bash
git add src/daily.js test/daily.test.js
git commit -m "日次グループ化の純関数 daily.js を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 履歴タブの配線（目標カード・日付グループ・今日チップ・日次グラフ）

**Files:**
- Modify: `index.html`（履歴セクションに目標カード用コンテナ追加）
- Modify: `src/ui/historyView.js`
- Modify: `src/styles.css`
- Test: `test/ui.smoke.test.js`（追記）

**Interfaces:**
- Consumes:
  - Task 1: `GOAL_KEYS` / `loadGoals()` / `saveGoals(goals)` / `goalStatus(latestRaw, goalRaw)` / `formatGoalStatus(status, metric)`
  - Task 2: `dateKeyOf(iso)` / `groupByDay(records)` / `dailyLatest(records)`
  - 既存: `metricByKey` / `validateInput`（metrics.js）、`previousValue`（trend.js）、`buildChart`（chart.js）
- Produces: なし（UI 最終段）

- [ ] **Step 1: 失敗するスモークテストを追記**

`test/ui.smoke.test.js` の `describe('UI初期化', ...)` 内に追加
（**注意: 履歴タブをクリックしてはいけない** — render() が IndexedDB に触り happy-dom には無い。静的 DOM の存在確認のみ）:

```js
  it('履歴タブに目標カード用のコンテナがある', () => {
    expect(document.getElementById('history-goals')).not.toBeNull();
  });
```

Run: `npx vitest run test/ui.smoke.test.js`
Expected: FAIL（`history-goals` が存在しない）

- [ ] **Step 2: index.html に目標カード用コンテナを追加**

`index.html` の履歴セクション内、`<div id="history-summary"></div>` の直後に1行追加:

```html
      <div id="history-summary"></div>
      <div id="history-goals"></div>
```

Run: `npx vitest run test/ui.smoke.test.js`
Expected: PASS

- [ ] **Step 3: historyView.js に目標カードを実装**

`src/ui/historyView.js` を変更する。

(a) import を追加（ファイル冒頭）:

```js
import { METRICS, metricByKey, validateInput } from '../metrics.js';
import { listMeasurements, deleteMeasurement, addMeasurements } from '../db.js';
import { exportCsv } from '../csv.js';
import { computeDelta, formatDelta, previousValue } from '../trend.js';
import { buildChart, PERIODS, PAD, CHART_W } from '../chart.js';
import { parseCsvText, dedupeByDateKey } from '../csvImport.js';
import { GOAL_KEYS, loadGoals, saveGoals, goalStatus, formatGoalStatus } from '../goals.js';
import { dateKeyOf, groupByDay, dailyLatest } from '../daily.js';
```

(b) 要素参照と状態を追加（`const summaryEl = ...` の直後に要素参照、`let selectedPeriod = ...` の直後に状態）:

```js
  const goalsEl = document.getElementById('history-goals');
```

```js
  let editingGoals = false;
```

(c) `renderSummary()` の後に目標カードのレンダリング関数を追加:

```js
  /* ---- 目標カード ---- */

  function renderGoals() {
    goalsEl.innerHTML = '';
    const goals = loadGoals();
    const hasGoals = GOAL_KEYS.some((k) => goals[k] != null);

    const card = document.createElement('div');
    card.className = 'goal-card';

    if (editingGoals) {
      const title = document.createElement('div');
      title.className = 'goal-title';
      title.textContent = '🎯 目標';

      const form = document.createElement('div');
      form.className = 'goal-form';
      const inputs = {};
      for (const key of GOAL_KEYS) {
        const m = metricByKey(key);
        const row = document.createElement('label');
        row.className = 'goal-edit-row';

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = m.label;

        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = goals[key] ?? '';
        input.placeholder = '未設定';

        const unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = m.unit;

        row.append(label, input, unit);
        form.appendChild(row);
        inputs[key] = input;
      }

      const actions = document.createElement('div');
      actions.className = 'goal-actions';

      const btnSave = document.createElement('button');
      btnSave.type = 'button';
      btnSave.className = 'btn primary';
      btnSave.textContent = '保存';
      btnSave.addEventListener('click', () => {
        const next = {};
        for (const key of GOAL_KEYS) {
          const m = metricByKey(key);
          const raw = inputs[key].value.trim();
          if (raw === '') continue; // 空 = その項目の目標を解除
          if (!validateInput(raw, m)) {
            alert(`「${m.label}」の目標値 ${raw} が範囲外です（${m.min}〜${m.max}）`);
            inputs[key].focus();
            return;
          }
          next[key] = raw;
        }
        saveGoals(next);
        editingGoals = false;
        renderGoals();
      });

      const btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.className = 'btn';
      btnCancel.textContent = 'キャンセル';
      btnCancel.addEventListener('click', () => {
        editingGoals = false;
        renderGoals();
      });

      actions.append(btnSave, btnCancel);
      card.append(title, form, actions);
    } else if (!hasGoals) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-btn';
      btn.textContent = '🎯 目標を設定する';
      btn.addEventListener('click', () => {
        editingGoals = true;
        renderGoals();
      });
      card.appendChild(btn);
    } else {
      const head = document.createElement('div');
      head.className = 'goal-head';

      const title = document.createElement('span');
      title.className = 'goal-title';
      title.textContent = '🎯 目標';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'link-btn';
      btnEdit.textContent = '編集';
      btnEdit.addEventListener('click', () => {
        editingGoals = true;
        renderGoals();
      });

      head.append(title, btnEdit);
      card.appendChild(head);

      for (const key of GOAL_KEYS) {
        if (goals[key] == null) continue;
        const m = metricByKey(key);
        const row = document.createElement('div');
        row.className = 'goal-row';

        const label = document.createElement('span');
        label.textContent = `${m.label} 目標 ${goals[key]}${m.unit}`;
        row.appendChild(label);

        // 直近の測定値（値がある最新レコード）との差。記録がなければ目標値のみ表示
        const st = goalStatus(previousValue(records, key), goals[key]);
        const statusText = formatGoalStatus(st, m);
        if (statusText != null) {
          const status = document.createElement('span');
          status.className = 'goal-status' + (st.achieved ? ' achieved' : '');
          status.textContent = statusText;
          row.appendChild(status);
        }
        card.appendChild(row);
      }
    }

    goalsEl.appendChild(card);
  }
```

(d) `render()` に `renderGoals()` を追加:

```js
  async function render() {
    records = await listMeasurements();
    trendCardEl.hidden = records.length === 0;
    renderSummary();
    renderGoals();
    renderMetricChips();
    renderPeriodButtons();
    renderChart();
    renderList();
  }
```

- [ ] **Step 4: 今日チップ・日次グラフ・日付グループを実装**

同じく `src/ui/historyView.js`:

(a) `renderSummary()` 内、`card.append(date, grid);` を今日チップ付きに変更:

```js
    // 「今日は測定済みか」の視覚フィードバック
    const measuredToday = dateKeyOf(latest.measuredAt) === dateKeyOf(new Date().toISOString());
    const today = document.createElement('div');
    today.className = 'today-chip' + (measuredToday ? ' done' : '');
    today.textContent = measuredToday ? '✓ 今日は測定済み' : '今日はまだ測定していません';

    card.append(today, date, grid);
```

(b) `renderChart()` 内、`buildChart(records, selectedKey, {...})` の呼び出しを日次代表値（1日1点）に変更:

```js
    const chart = buildChart(dailyLatest(records), selectedKey, {
      days: period.days,
      decimals: metric.decimals,
    });
```

(c) `renderList()` を日付見出し付きのグループ表示に置き換え（関数全体を差し替え）:

```js
  function formatTime(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  function formatDayHeading(group) {
    const d = new Date(group.latest.measuredAt);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}（${DAY_NAMES[d.getDay()]}）・${group.records.length}件`;
  }

  function renderList() {
    listEl.innerHTML = '';
    if (records.length === 0) {
      const p = document.createElement('p');
      p.className = 'history-empty';
      p.textContent = 'まだ記録がありません';
      listEl.appendChild(p);
      return;
    }
    for (const group of groupByDay(records)) {
      const heading = document.createElement('div');
      heading.className = 'history-day';
      heading.textContent = formatDayHeading(group);
      listEl.appendChild(heading);

      for (const r of group.records) {
        const item = document.createElement('div');
        item.className = 'history-item';

        const date = document.createElement('div');
        date.className = 'date';
        date.textContent = formatTime(r.measuredAt);

        const values = document.createElement('div');
        values.className = 'values';
        for (const m of METRICS) {
          if (r[m.key] == null || r[m.key] === '') continue;
          const span = document.createElement('span');
          span.textContent = `${m.label} ${r[m.key]}${m.unit}`;
          values.appendChild(span);
        }

        const del = document.createElement('button');
        del.className = 'delete';
        del.textContent = 'この記録を削除';
        del.addEventListener('click', async () => {
          if (!confirm(`${formatDate(r.measuredAt)} の記録を削除しますか？`)) return;
          await deleteMeasurement(r.id);
          render();
        });

        item.append(date, values, del);
        listEl.appendChild(item);
      }
    }
  }
```

注: 既存の `formatDate`（フル日時）は削除確認ダイアログとサマリーカードで引き続き使うので残す。

- [ ] **Step 5: CSS を追加**

`src/styles.css` の「履歴画面: リスト」セクションの後に追加:

```css
/* ---- 履歴画面: 目標カード ---- */
.goal-card {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 12px 16px;
  box-shadow: var(--shadow);
  margin-bottom: 12px;
}
.goal-head { display: flex; justify-content: space-between; align-items: center; }
.goal-title { font-size: 0.85rem; font-weight: 600; }
.link-btn {
  background: none; border: none; padding: 4px 0;
  color: var(--accent-dark); font-size: 0.85rem; font-family: inherit;
  cursor: pointer; text-decoration: underline;
}
.goal-row {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 8px; font-size: 0.9rem; font-variant-numeric: tabular-nums;
}
.goal-status { color: var(--text-dim); font-size: 0.85rem; }
.goal-status.achieved { color: var(--ok); font-weight: 600; }
.goal-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.goal-edit-row { display: flex; align-items: center; gap: 8px; }
.goal-edit-row .label { width: 5em; color: var(--text-dim); font-size: 0.85rem; }
.goal-edit-row input {
  flex: 1; font-size: 1rem; font-family: inherit;
  font-variant-numeric: tabular-nums;
  background: none; border: none; color: var(--lcd-text);
  border-bottom: 1px dashed var(--panel-2); outline: none;
}
.goal-edit-row input:focus { border-bottom-color: var(--accent); }
.goal-edit-row .unit { color: var(--text-dim); font-size: 0.8rem; width: 3em; }
.goal-actions { display: flex; gap: 10px; margin-top: 12px; }

/* ---- 履歴画面: 今日チップ・日付見出し ---- */
.today-chip {
  display: inline-block;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 0.75rem;
  background: var(--panel-2);
  color: var(--text-dim);
  margin-bottom: 8px;
}
.today-chip.done {
  background: var(--lcd-bg);
  border: 1px solid var(--lcd-border);
  color: var(--lcd-text);
}
.history-day {
  color: var(--text-dim);
  font-size: 0.8rem;
  font-weight: 600;
  margin: 8px 0 -2px;
}
```

- [ ] **Step 6: 全テストとビルドを確認**

Run: `npx vitest run && npm run build`
Expected: 全テスト PASS、ビルド成功

- [ ] **Step 7: コミット**

```bash
git add index.html src/ui/historyView.js src/styles.css test/ui.smoke.test.js
git commit -m "履歴タブに目標カード・日付グループ・今日チップを追加しグラフを日次代表値に変更

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 測定記録の手動入力（確認画面の手入力モード）

**Files:**
- Modify: `index.html`（計測タブに手入力リンク、確認画面の見出しに id 付与）
- Modify: `src/ui/confirmView.js`（手入力モード: 日時欄・文言出し分け・measuredAt）
- Modify: `src/main.js`（手入力導線の配線）
- Modify: `src/styles.css`
- Test: `test/ui.smoke.test.js`（追記）

**Interfaces:**
- Consumes: 既存の `switchView(id, ...args)`（main.js）、`createConfirmView`
- Produces: `confirmView.show(results, opts)` — `opts = { manual: true }` で手入力モード。`captureView.js`・`importView.js` からの既存呼び出し（`show(results)` のみ）は無変更で動く

- [ ] **Step 1: 失敗するスモークテストを追記**

`test/ui.smoke.test.js` の `describe('UI初期化', ...)` 内に追加:

```js
  it('計測タブに手入力リンクがある', () => {
    const btn = document.getElementById('btn-manual-entry');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('手入力');
  });

  it('手入力リンクで確認画面が手入力モード（日時入力つき）で開く', async () => {
    document.getElementById('btn-manual-entry').click();
    expect(document.getElementById('view-confirm').hidden).toBe(false);
    expect(document.getElementById('confirm-title').textContent).toBe('測定値の手入力');
    // render は async（前回値の取得を待つ）なのでマイクロタスクを流す
    await new Promise((r) => setTimeout(r, 0));
    const dt = document.querySelector('#confirm-list .confirm-datetime input');
    expect(dt).not.toBeNull();
    expect(dt.value).not.toBe('');
    // 計測タブへ戻す（後続テストへの影響を避ける）
    document.querySelector('.tab[data-view="view-capture"]').click();
  });
```

Run: `npx vitest run test/ui.smoke.test.js`
Expected: FAIL（`btn-manual-entry` が存在しない）

- [ ] **Step 2: index.html を変更**

(a) 計測セクションの `.capture-actions` の div の直後に追加:

```html
      <p class="manual-entry">
        <button id="btn-manual-entry" class="link-btn" type="button">カメラを使わず手入力で記録する</button>
      </p>
```

(b) 確認セクションの見出しと説明文に id を付与（文言は変えない）:

```html
      <h2 id="confirm-title">測定結果の確認</h2>
      <p id="confirm-note" class="note">読み間違いがないか確認してください。タップで修正できます。</p>
```

- [ ] **Step 3: confirmView.js に手入力モードを実装**

`src/ui/confirmView.js` を変更する。

(a) 要素参照と状態を追加（`const listEl = ...` の前後に）:

```js
  const titleEl = document.getElementById('confirm-title');
  const noteEl = document.getElementById('confirm-note');
```

```js
  let inputs = {}; // key → input要素
  let manualMode = false;
  let dateInput = null;
```

(b) 日時の初期値用ヘルパーを追加（`render` の前）:

```js
  // datetime-local の value 形式（ローカル時刻の YYYY-MM-DDTHH:MM）
  function nowLocalValue() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
```

(c) `render` を手入力モード対応にする。シグネチャを変更し、冒頭で文言を出し分け、`listEl.innerHTML = ''` の直後に日時行を挿入:

```js
  async function render(results, { manual = false } = {}) {
    manualMode = manual;
    dateInput = null;
    titleEl.textContent = manual ? '測定値の手入力' : '測定結果の確認';
    noteEl.textContent = manual
      ? '測定した値を入力してください。空欄は未計測として保存されます。'
      : '読み間違いがないか確認してください。タップで修正できます。';

    // 前回値: 誤読チェックにも効く（前回と大きく違う値は読み間違いの可能性）
    const prev = {};
    try {
      const records = await listMeasurements();
      for (const m of METRICS) prev[m.key] = previousValue(records, m.key);
    } catch {
      // 前回値が取れなくても確認画面自体は出す
    }

    listEl.innerHTML = '';
    inputs = {};

    if (manual) {
      const row = document.createElement('div');
      row.className = 'confirm-datetime';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = '日時';
      dateInput = document.createElement('input');
      dateInput.type = 'datetime-local';
      dateInput.value = nowLocalValue();
      row.append(label, dateInput);
      listEl.appendChild(row);
    }

    for (const m of METRICS) {
      // …既存の項目行の構築ループは無変更…
    }
  }
```

（`for (const m of METRICS)` ループの中身は既存コードのまま。変更点は冒頭の文言出し分けと日時行の挿入のみ）

(d) `btnSave` のハンドラ冒頭、`const record = { measuredAt: new Date().toISOString() };` を差し替え:

```js
  btnSave.addEventListener('click', async () => {
    let measuredAt;
    if (manualMode) {
      const t = dateInput?.value ? new Date(dateInput.value) : null;
      if (!t || Number.isNaN(t.getTime())) {
        alert('日時を入力してください');
        return;
      }
      measuredAt = t.toISOString();
    } else {
      measuredAt = new Date().toISOString();
    }
    const record = { measuredAt };
    // …以降（バリデーション・hasValue・addMeasurement・onSaved）は既存コードのまま…
```

(e) `show` を opts 対応に:

```js
    show(results, opts) {
      render(results ?? {}, opts);
    },
```

- [ ] **Step 4: main.js に導線を配線**

`src/main.js` のタブ配線（`document.querySelectorAll('.tab')...`）の直前に追加:

```js
// カメラが使えない場面用: 確認画面を手入力モードで開く
document.getElementById('btn-manual-entry').addEventListener('click', () => {
  switchView('view-confirm', {}, { manual: true });
});
```

（`switchView` は既存実装のまま可変長引数を `view.show(...args)` に渡すので変更不要。view-confirm は計測タブ扱いのハイライトも既存のまま）

- [ ] **Step 5: CSS を追加**

`src/styles.css` に追加（Task 3 で追加した `.link-btn` を流用。計測画面セクションの末尾に）:

```css
.manual-entry { text-align: center; margin-top: 12px; }
```

確認画面セクション（`.confirm-row` 付近）に:

```css
.confirm-datetime {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--panel-2);
}
.confirm-datetime .label { color: var(--text-dim); font-size: 0.85rem; width: 5em; }
.confirm-datetime input {
  flex: 1; font-family: inherit; font-size: 0.95rem;
  background: none; border: none; color: var(--text); outline: none;
}
```

注: Task 4 を Task 3 より先に実施する場合は `.link-btn` の定義（Task 3 Step 5 参照）もここで追加すること。

```css
.link-btn {
  background: none; border: none; padding: 4px 0;
  color: var(--accent-dark); font-size: 0.85rem; font-family: inherit;
  cursor: pointer; text-decoration: underline;
}
```

- [ ] **Step 6: テストとビルドを確認**

Run: `npx vitest run && npm run build`
Expected: 全テスト PASS（Step 1 で追記した2件を含む）、ビルド成功

- [ ] **Step 7: コミット**

```bash
git add index.html src/ui/confirmView.js src/main.js src/styles.css test/ui.smoke.test.js
git commit -m "計測タブから測定値を手入力できるようにする（確認画面に手入力モード）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 総合検証とデプロイ

**Files:**
- なし（検証・デプロイ・メモリ更新のみ）

**Interfaces:**
- Consumes: Task 1〜4 のすべて
- Produces: 本番デプロイ

- [ ] **Step 1: 全テストとビルド**

Run: `npx vitest run && npm run build`
Expected: 全テスト PASS、`dist/sw.js` 生成まで成功

- [ ] **Step 2: 実ブラウザで確認（Playwright MCP）**

開発サーバー（`npm run dev`、URL はコンソール出力に従う）+ Playwright MCP で確認する。
IndexedDB シードは **必ず app と同じ upgrade 処理**（`createObjectStore('measurements', { keyPath: 'id', autoIncrement: true })` + `createIndex('measuredAt', 'measuredAt')`）を付けて開くこと（付けないと空DBができて壊れる）。

1. シード: 今日の 07:30（weight 64.0, bodyFat 21.0）と 21:00（weight 63.4, bodyFat 20.5）、昨日の 07:30（weight 63.8, bodyFat 21.2）の3件を投入。`localStorage.setItem('krdscan-goals', JSON.stringify({ weight: '63.0', bodyFat: '22.0' }))`
2. リロードして履歴タブを開き、以下を確認:
   - サマリーカードに `✓ 今日は測定済み` チップ
   - 目標カード: `体重 目標 63.0kg` に `あと 0.4kg`、`体脂肪率 目標 22.0%` に `🎉 達成！（−1.5%）`
   - 履歴リスト: 今日の見出しに `・2件`、昨日の見出しに `・1件`、レコード行は時刻表示
   - 推移グラフ（体重・1ヶ月）: 日次代表値なので **2点**（63.4 と 63.8）
3. 目標編集: 「編集」→ 体重を `64.0` に変更して保存 → `🎉 達成！` 表示に変わる → 再度編集で `63.0` に戻す。範囲外（例 `999`）はアラートで弾かれることも確認
4. 手動入力: 計測タブ →「カメラを使わず手入力で記録する」→ 日時を一昨日の 08:00 に変更、体重 `63.9` のみ入力 → 保存 → 履歴に一昨日の見出しと記録が現れる
5. 後片付け: `indexedDB.deleteDatabase('karadascan')` と `localStorage.removeItem('krdscan-goals')`

- [ ] **Step 3: push とデプロイ確認**

```bash
git push origin main
gh run list --repo qnosuke/krd-scan --limit 2
```

（最初の run が concurrency で auto-cancel され後続が success になるのは既知パターン）

デプロイ完了後:

```bash
curl -s https://qnosuke.github.io/krd-scan/ | shasum
shasum dist/index.html
```

Expected: 2つのハッシュが一致

- [ ] **Step 4: メモリ更新**

`~/.claude/projects/-Users-adlibmacmini2021-Documents-project-karadascan/memory/karadascan-project-state.md` に3機能の実装完了（日付・コミット・設計の要点: localStorage の `krdscan-goals`・達成=以下・日次代表値=最新・グラフ1日1点・手入力は確認画面流用）を追記し、`MEMORY.md` のインデックス行も更新する。
