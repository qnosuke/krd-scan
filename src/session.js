import { METRICS, matchesMetric } from './metrics.js';

// 整列コスト（RUN_REWARD=1 を基準にした相対値）
const RUN_REWARD = 1; // 確定値をどこかの位置に割り当てられたときの得点
const SKIP_COST = 0.5; // 表示順で読み逃した画面1つあたり
const SKIP0_EXTRA = 0.5; // 周回の先頭（体重画面）の読み飛ばしはさらに割高
const WRAP_COST = 1; // 周回をまたぐ遷移。本物の複数周回では全候補が同数またぐので
// 相殺されるが、「先頭の値をBMIとみなして全体をずらす」誤解釈だけが余計にまたぐ
const SAMEPOS_COST = 0.25; // 同じ画面のブレ（部分欠け・1桁違いの読み違え）
const SAMEPOS_ALIEN = 2; // 読み違えとは思えない別の値が同じ画面に留まる遷移
// （捨てるのと同等の扱い。安くすると無関係な値を1つの位置に積む抜け道になる）
const DROP_COST = 2; // どの位置にも整合しない確定値を捨てる
const AFFINITY_BONUS = 1; // 「同じ値は毎周回同じ画面に出る」一貫性の優遇。
// 既知の体重と同じ値が再登場したらBMIより体重を優先できる強さが必要
const ATYPICAL_COST = 0.75; // 現実の人間として不自然な割り当て（体重15.8kg、
// BMI 62.7 等）。並び順だけでは対称で区別できない誤解釈を弾く決め手になる
const START_BIAS = 0.01; // 同点なら周回の早い位置から始まる整列を優先

/**
 * 2つの読み取り文字列が同じ表示の読み違えとしてあり得るか。
 * 7セグ誤読は「端の桁が欠ける」（64.2→4.2）か「1画面内のセグメント
 * 誤判定」（1桁だけ違う）のどちらかで起きる
 */
function isPlausibleMisread(a, b) {
  if (a == null || b == null) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff <= 1;
}

/**
 * 計測セッションのステートマシン。
 *
 * フレームごとの読み取り結果（文字列 or null）を feed() に渡すと、
 * 同じ値が stableFrames 回連続したとき「確定値」になる。確定値の列を
 * KRD-203 の表示周回（体重→体脂肪率→内臓脂肪→骨格筋率→体年齢→
 * 基礎代謝→BMI の繰り返し）に動的計画法で整列させ、項目を割り当てる。
 *
 * 以前は「最初の体重形式の値を周回の先頭とみなす」オンライン割り当て
 * だったが、周回の途中から読み始めると体脂肪率などが体重に誤アンカー
 * され、以後のルールでは回復できなかった。列全体を毎回整列し直す方式
 * なら、後続の並びや次の周回と矛盾した割り当ては自動で修正される。
 *
 * 整列のルール:
 * - 各確定値は数値レンジ・小数桁が合う画面位置にしか置けない
 * - 位置は表示順に進む。読み逃しはスキップ（コスト小）、どこにも
 *   合わない値は捨てる（コスト大）
 * - 同じ値は毎周回同じ画面に出るはずなので、1回目の整列で得た
 *   値→位置の傾向を2回目の整列で優遇する（BMIと体重のように
 *   レンジが重なる位置の曖昧さを周回の一貫性で解消する）
 * - 結果は位置ごとに確定値の多数決。票は表示され続けた時間
 *   （stableFrames の倍数ごとに加算）に比例し、画面切り替わりの
 *   一瞬の誤読（64.2 の先頭欠け 4.2 等）は本物の値が上書きする
 * - 「1」はユーザー番号画面・細長い影の誤読が非常に多いため無視する
 *   （内臓脂肪レベル1だけは自動で読めないが、確認画面で手入力できる）
 * - 測定前画面（ユーザー番号・生年月日等）は整数のみなので、
 *   小数付きの測定値を見るまで整数の確定値は無視する
 */
export class CaptureSession {
  constructor({ stableFrames = 3 } = {}) {
    this.stableFrames = stableFrames;
    this.candidateText = null;
    this.candidateCount = 0;
    this.runs = []; // { text, weight, matches: number[], pos: number|null }
    this.activated = false; // 小数付きの測定値を見たか
    this.results = {};
  }

  /**
   * 1フレーム分の読み取り結果を処理する。
   * @param {string|null} text 読み取れた表示文字列（例 "62.7"）。読めなければ null
   * @returns {{ captured: string|null, complete: boolean }}
   *   captured: このフレームで新しく割り当てられた項目キー（なければ null）
   */
  feed(text) {
    if (text == null || text === '1') {
      // 一瞬の読み取り失敗や「1」誤読ではカウントをリセットしない
      return { captured: null, complete: this.isComplete() };
    }
    if (text === this.candidateText) {
      this.candidateCount++;
    } else {
      this.candidateText = text;
      this.candidateCount = 1;
    }
    let captured = null;
    // stableFrames 回続くごとに確定を繰り返す: 表示され続ける時間に
    // 比例して票が重くなり、瞬間的な誤読を本物の値が多数決で上書きできる
    if (this.candidateCount % this.stableFrames === 0) {
      captured = this.#confirm(text);
    }
    return { captured, complete: this.isComplete() };
  }

  #confirm(text) {
    const last = this.runs[this.runs.length - 1];
    if (last && last.text === text) {
      // 同じ画面が表示され続けている（または一瞬のブレを挟んで戻った）
      last.weight++;
      this.#realign();
      return null;
    }
    const matches = [];
    for (let i = 0; i < METRICS.length; i++) {
      if (matchesMetric(text, METRICS[i])) matches.push(i);
    }
    if (matches.length === 0) return null;
    if (!this.activated) {
      if (!text.includes('.')) return null; // 測定前画面の整数を無視
      this.activated = true;
    }
    const run = { text, weight: 1, matches, pos: null };
    this.runs.push(run);
    this.#realign();
    return run.pos == null ? null : METRICS[run.pos].key;
  }

  /** 確定値の列全体を表示周回に整列し直し、結果を集計する */
  #realign() {
    const pass1 = this.#align(() => 0);
    // 値→位置の傾向（同じ値の割り当て位置ごとの重み）。最重の位置を
    // その値の定位置とみなし、同点なら先に現れた位置を採る
    const affinity = new Map(); // text → Map(pos → weight)
    this.runs.forEach((run, r) => {
      const p = pass1[r];
      if (p == null) return;
      const m = affinity.get(run.text) ?? new Map();
      m.set(p, (m.get(p) ?? 0) + run.weight);
      affinity.set(run.text, m);
    });
    const bestPos = new Map();
    for (const [text, m] of affinity) {
      let bp = null;
      let bw = 0;
      for (const [p, w] of m) {
        if (w > bw) {
          bp = p;
          bw = w;
        }
      }
      bestPos.set(text, bp);
    }
    const pass2 = this.#align((run, q) => (bestPos.get(run.text) === q ? AFFINITY_BONUS : 0));
    this.runs.forEach((run, r) => {
      run.pos = pass2[r];
    });
    this.#tally();
  }

  /**
   * 動的計画法で各確定値に画面位置（または捨てる=null）を割り当てる。
   * 状態は「最後に割り当てた位置」（0〜6、まだ無ければ NONE）。
   * @param {(run, pos) => number} bonus 位置ごとの追加得点
   * @returns {(number|null)[]} runs と同じ長さの位置の配列
   */
  #align(bonus) {
    const NONE = 7;
    let score = new Array(8).fill(-Infinity);
    score[NONE] = 0;
    const choices = []; // choices[r][state] = { from, pos }
    for (let r = 0; r < this.runs.length; r++) {
      const run = this.runs[r];
      const prevText = r > 0 ? this.runs[r - 1].text : null;
      const value = Number(run.text);
      // 位置ごとの「人間として不自然な値」ペナルティ（遷移元によらない）
      const atypical = new Map();
      for (const q of run.matches) {
        const m = METRICS[q];
        const bad =
          (m.typicalMin != null && value < m.typicalMin) ||
          (m.typicalMax != null && value > m.typicalMax);
        atypical.set(q, bad ? ATYPICAL_COST : 0);
      }
      const next = new Array(8).fill(-Infinity);
      const ch = new Array(8).fill(null);
      for (let s = 0; s < 8; s++) {
        if (score[s] === -Infinity) continue;
        // この確定値を捨てる（位置は進まない）
        if (score[s] - DROP_COST > next[s]) {
          next[s] = score[s] - DROP_COST;
          ch[s] = { from: s, pos: null };
        }
        // レンジ・小数桁の合う位置に割り当てる
        for (const q of run.matches) {
          let cost;
          if (s === NONE) {
            cost = q * START_BIAS;
          } else if (q === s) {
            // 同じ画面に留まる = 直前の確定値は同一画面の読み違えのはず。
            // 部分欠け（64.2→4.2）や1桁違いなら安く、無関係な値なら高く
            cost = isPlausibleMisread(run.text, prevText) ? SAMEPOS_COST : SAMEPOS_ALIEN;
          } else {
            // s から q まで表示順に進んだときに読み逃した画面数ぶんのコスト
            cost = SKIP_COST * ((q - s - 1 + 7) % 7);
            if (q < s) {
              // 周回またぎ。さらに周回頭の体重画面(位置0)まで読み飛ばす
              // 経路（値をBMIとみなして全体をずらす誤解釈に典型）は割高
              cost += WRAP_COST;
              if (q !== 0) cost += SKIP0_EXTRA;
            }
          }
          const sc = score[s] + RUN_REWARD + bonus(run, q) - cost - atypical.get(q);
          if (sc > next[q]) {
            next[q] = sc;
            ch[q] = { from: s, pos: q };
          }
        }
      }
      choices.push(ch);
      score = next;
    }
    // 最良の最終状態から遡って割り当てを復元（同点は先頭側の位置を優先）
    let best = NONE;
    for (let s = 0; s < 7; s++) {
      if (score[s] > score[best]) best = s;
    }
    const assignment = new Array(this.runs.length).fill(null);
    let state = best;
    for (let r = this.runs.length - 1; r >= 0; r--) {
      const c = choices[r][state];
      assignment[r] = c.pos;
      state = c.from;
    }
    return assignment;
  }

  /** 位置ごとに確定値の多数決（重み付き・同点は先に現れた値） */
  #tally() {
    const results = {};
    for (let p = 0; p < METRICS.length; p++) {
      const counts = new Map();
      for (const run of this.runs) {
        if (run.pos !== p) continue;
        counts.set(run.text, (counts.get(run.text) ?? 0) + run.weight);
      }
      let bestText = null;
      let bestWeight = 0;
      for (const [text, w] of counts) {
        if (w > bestWeight) {
          bestText = text;
          bestWeight = w;
        }
      }
      if (bestText != null) results[METRICS[p].key] = bestText;
    }
    this.results = results;
  }

  isComplete() {
    return Object.keys(this.results).length >= METRICS.length;
  }

  /** これまでの結果 { key: text } */
  getResults() {
    return { ...this.results };
  }

  capturedCount() {
    return Object.keys(this.results).length;
  }
}
