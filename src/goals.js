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
