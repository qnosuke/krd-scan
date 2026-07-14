import { METRICS, matchesMetric } from './metrics.js';

/**
 * 計測セッションのステートマシン。
 *
 * フレームごとの読み取り結果（文字列 or null）を feed() に渡すと、
 * - 同じ値が stableFrames 回連続したら「確定」
 * - 確定値を KRD-203 の表示順に沿って項目に割り当てる
 *
 * KRD-203 は7項目の表示周回を繰り返すため、実機動画で得た知見に基づき
 * 次のルールで誤読に耐える:
 * - 周回の先頭は体重（小数1桁・2〜135.4）のみ受理（アンカー）。
 *   測定前画面のユーザー番号「1」や生年月日の断片を誤割当てしないため。
 * - アンカー後は表示順に前方一致（読み逃した項目はスキップ）。
 * - どの後続項目にも合わない体重形式の値は新しい周回の先頭とみなし再アンカー。
 * - 確定値は項目ごとに「票」として集計し、getResults() は多数決で返す。
 *   1周だけの誤読（ぶれた瞬間の誤認識）は後続の周回が上書きする。
 * - 「1」はユーザー番号画面・細長い影の誤読が非常に多いため無視する
 *   （内臓脂肪レベル1だけは自動で読めないが、確認画面で手入力できる）。
 * - 直前の確定値と同じ表示は無視（同じ画面が続いているだけ）。
 */
export class CaptureSession {
  constructor({ stableFrames = 3 } = {}) {
    this.stableFrames = stableFrames;
    this.votes = {}; // key → Map(text → 票数)
    this.expectedIndex = 0;
    this.candidateText = null;
    this.candidateCount = 0;
    this.lastConfirmedText = null;
    this.lastConfirmedKey = null; // 直前の確定が票を入れた項目（追加票の宛先）
  }

  /**
   * 1フレーム分の読み取り結果を処理する。
   * @param {string|null} text 読み取れた表示文字列（例 "62.7"）。読めなければ null
   * @returns {{ captured: string|null, complete: boolean }}
   *   captured: このフレームで票が入った項目キー（なければ null）
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
    // 比例して票が重くなり、画面切り替わりのブレによる瞬間的な誤読
    // （3フレーム程度しか続かない）を本物の値が多数決で上書きできる
    if (this.candidateCount >= this.stableFrames && this.candidateCount % this.stableFrames === 0) {
      captured = this.#confirm(text);
    }
    return { captured, complete: this.isComplete() };
  }

  #confirm(text) {
    if (text === this.lastConfirmedText) {
      // 同じ画面が表示され続けている: 割り当ては変えず追加票だけ入れる
      if (this.lastConfirmedKey) this.#vote(this.lastConfirmedKey, text);
      return null;
    }
    this.lastConfirmedText = text;
    this.lastConfirmedKey = null;

    // どれかの項目の現最多票と同じ値は「その画面の再表示」とみなし、
    // 票を加えず周回位置だけ合わせ直す。BMIや体重はレンジが広く他項目の
    // 値も飲み込むため、期待位置ベースの割り当てに任せると
    // 周回頭の体重や読み逃し後の骨格筋率がBMIに、本物のBMIが体重に化ける。
    // 票を加えないのは、誤アンカーされた値が最多票のとき自己増幅して
    // 後続周回の正しい値が多数決で追い付けなくなるのを防ぐため。
    // 複数項目と一致する場合は期待位置以降を優先（周回は前へ進む）。
    const seen = [];
    for (let i = 0; i < METRICS.length; i++) {
      if (this.#majority(METRICS[i].key) === text) seen.push(i);
    }
    if (seen.length > 0) {
      const i = seen.find((k) => k >= this.expectedIndex) ?? seen[0];
      this.expectedIndex = i + 1;
      return METRICS[i].key;
    }

    // アンカー後: 表示順に沿って期待位置から先を探す
    if (this.expectedIndex > 0) {
      for (let i = this.expectedIndex; i < METRICS.length; i++) {
        const metric = METRICS[i];
        // BMI はレンジが広く（2.5〜90・小数1桁）体重・体脂肪率・骨格筋率の
        // 値も飲み込んでしまう。前の項目を大きく読み逃してBMIに飛ぶのは
        // 「新しい周回の体重」の可能性が高いため、基礎代謝(直前)以降を
        // 期待しているときしかBMIへのスキップを許可しない。
        if (metric.key === 'bmi' && i > this.expectedIndex && this.expectedIndex < 5) break;
        if (matchesMetric(text, metric)) {
          this.#vote(metric.key, text);
          this.lastConfirmedKey = metric.key;
          this.expectedIndex = i + 1;
          return metric.key;
        }
      }
    }
    // 体重形式なら（新しい）表示周回の先頭とみなしてアンカーする
    if (matchesMetric(text, METRICS[0])) {
      this.#vote(METRICS[0].key, text);
      this.lastConfirmedKey = METRICS[0].key;
      this.expectedIndex = 1;
      return METRICS[0].key;
    }
    return null; // アンカー前の値・どの項目にも合わない値は無視
  }

  #vote(key, text) {
    const counts = (this.votes[key] ??= new Map());
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  /** 項目の現時点の最多票の値（票がなければ null） */
  #majority(key) {
    let best = null;
    let bestCount = 0;
    for (const [text, count] of this.votes[key] ?? []) {
      if (count > bestCount) {
        best = text;
        bestCount = count;
      }
    }
    return best;
  }

  isComplete() {
    return Object.keys(this.votes).length >= METRICS.length;
  }

  /** これまでの結果 { key: text }。項目ごとに最多票の値を返す */
  getResults() {
    const results = {};
    for (const key of Object.keys(this.votes)) {
      results[key] = this.#majority(key);
    }
    return results;
  }

  capturedCount() {
    return Object.keys(this.votes).length;
  }
}
