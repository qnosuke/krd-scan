import { METRICS, matchesMetric } from './metrics.js';

/**
 * 計測セッションのステートマシン。
 *
 * フレームごとの読み取り結果（文字列 or null）を feed() に渡すと、
 * - 同じ値が stableFrames 回連続したら「確定」
 * - 確定値を KRD-203 の表示順に沿って項目に割り当てる
 *   （期待中の項目に合わなければ後続の項目を順に試す = 読み逃しに対応）
 * - 直前の確定値と同じ表示は無視（体重が計測中と結果表示で2回出るため）
 */
export class CaptureSession {
  constructor({ stableFrames = 3 } = {}) {
    this.stableFrames = stableFrames;
    this.results = {}; // key → text
    this.expectedIndex = 0;
    this.candidateText = null;
    this.candidateCount = 0;
    this.lastConfirmedText = null;
  }

  /**
   * 1フレーム分の読み取り結果を処理する。
   * @param {string|null} text 読み取れた表示文字列（例 "62.7"）。読めなければ null
   * @returns {{ captured: string|null, complete: boolean }}
   *   captured: このフレームで新たに確定した項目キー（なければ null）
   */
  feed(text) {
    if (text == null) {
      // 一瞬の読み取り失敗ではカウントをリセットしない（表示切替の瞬間など）
      return { captured: null, complete: this.isComplete() };
    }
    if (text === this.candidateText) {
      this.candidateCount++;
    } else {
      this.candidateText = text;
      this.candidateCount = 1;
    }
    let captured = null;
    if (this.candidateCount === this.stableFrames) {
      captured = this.#confirm(text);
    }
    return { captured, complete: this.isComplete() };
  }

  #confirm(text) {
    if (text === this.lastConfirmedText) return null; // 同じ表示が続いているだけ
    this.lastConfirmedText = text;

    for (let i = this.expectedIndex; i < METRICS.length; i++) {
      const metric = METRICS[i];
      if (matchesMetric(text, metric)) {
        this.results[metric.key] = text;
        this.expectedIndex = i + 1;
        return metric.key;
      }
    }
    return null; // どの項目にも合わない値は無視（計測途中の揺れなど）
  }

  isComplete() {
    return this.expectedIndex >= METRICS.length;
  }

  /** これまでに読み取れた結果 { key: text } */
  getResults() {
    return { ...this.results };
  }

  capturedCount() {
    return Object.keys(this.results).length;
  }
}
