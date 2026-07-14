import { describe, it, expect } from 'vitest';
import { CaptureSession } from '../src/session.js';

/** 同じ値をn回、間にnull（読み取り失敗フレーム）を挟んで流すヘルパー */
function feedStable(session, text, times = 5) {
  let lastCaptured = null;
  for (let i = 0; i < times; i++) {
    const { captured } = session.feed(text);
    if (captured) lastCaptured = captured;
    session.feed(null); // 読み取り失敗フレームが挟まっても壊れない
  }
  return lastCaptured;
}

const FULL_SEQUENCE = [
  ['62.7', 'weight'],
  ['15.8', 'bodyFat'],
  ['4', 'visceralFat'],
  ['39.9', 'skeletalMuscle'],
  ['22', 'bodyAge'],
  ['1545', 'basalMetabolism'],
  ['20.2', 'bmi'],
];

describe('CaptureSession', () => {
  it('フル計測シーケンスを7項目すべて正しく割り当てる', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    for (const [text, expectedKey] of FULL_SEQUENCE) {
      expect(feedStable(s, text)).toBe(expectedKey);
    }
    expect(s.isComplete()).toBe(true);
    expect(s.getResults()).toEqual({
      weight: '62.7',
      bodyFat: '15.8',
      visceralFat: '4',
      skeletalMuscle: '39.9',
      bodyAge: '22',
      basalMetabolism: '1545',
      bmi: '20.2',
    });
  });

  it('体重が計測中と結果表示で2回出ても1回だけ記録される', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    expect(feedStable(s, '62.7')).toBe('weight');
    feedStable(s, '62.7'); // 結果サイクル冒頭の再表示
    expect(feedStable(s, '15.8')).toBe('bodyFat');
    expect(s.getResults().weight).toBe('62.7');
  });

  it('項目を読み逃しても後続の項目は正しく割り当てられる', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    feedStable(s, '62.7');
    feedStable(s, '15.8');
    // 内臓脂肪レベル "4" を読み逃した
    expect(feedStable(s, '39.9')).toBe('skeletalMuscle');
    expect(s.getResults().visceralFat).toBeUndefined();
    expect(feedStable(s, '22')).toBe('bodyAge');
  });

  it('揺れている値（連続しない）は確定しない', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    for (let i = 0; i < 10; i++) {
      s.feed('62.7');
      s.feed('62.8');
    }
    expect(s.capturedCount()).toBe(0);
  });

  it('どの項目にも合わない値は無視される', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    feedStable(s, '999.9'); // レンジ外
    expect(s.capturedCount()).toBe(0);
    expect(feedStable(s, '62.7')).toBe('weight');
  });

  it('体重（周回の先頭）を読むまでは他の項目を割り当てない', () => {
    // 測定前画面のユーザー番号「1」や生年月日の断片「27」を
    // 内臓脂肪や体年齢に誤割当てしないため。表示周回は繰り返される
    // ので、体重より前に見えた項目は次の周回で回収できる。
    const s = new CaptureSession({ stableFrames: 3 });
    expect(feedStable(s, '27')).toBeNull(); // 生年月日画面の断片
    expect(feedStable(s, '4')).toBeNull(); // 途中からかざした内臓脂肪レベル
    expect(s.capturedCount()).toBe(0);
    expect(feedStable(s, '62.7')).toBe('weight');
    expect(feedStable(s, '4')).toBe('visceralFat');
  });

  it('「1」はユーザー番号画面や影の誤読が多いため無視される', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    feedStable(s, '62.7');
    feedStable(s, '15.8');
    expect(feedStable(s, '1')).toBeNull();
    expect(s.getResults().visceralFat).toBeUndefined();
  });

  it('周回の先頭（体重形式）で再アンカーして2周目以降も読める', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    // 1周目: 体重と体脂肪率だけ読めた
    feedStable(s, '62.7');
    feedStable(s, '15.8');
    // 2周目: 体重で再アンカー → 1周目で読み逃した後続項目を回収
    expect(feedStable(s, '62.7')).toBe('weight');
    expect(feedStable(s, '15.8')).toBe('bodyFat');
    expect(feedStable(s, '4')).toBe('visceralFat');
    expect(feedStable(s, '39.9')).toBe('skeletalMuscle');
    expect(s.getResults()).toMatchObject({
      weight: '62.7',
      bodyFat: '15.8',
      visceralFat: '4',
      skeletalMuscle: '39.9',
    });
  });

  it('誤読の票は複数周回の多数決で上書きされる', () => {
    const s = new CaptureSession({ stableFrames: 3 });
    // 1周目: 体重を読み逃し、体脂肪率画面が体重としてアンカーされてしまう
    feedStable(s, '15.8');
    feedStable(s, '4');
    // 2周目・3周目: 正しく読めた → 62.7×2票 > 15.8×1票
    for (let i = 0; i < 2; i++) {
      feedStable(s, '62.7');
      feedStable(s, '15.8');
      feedStable(s, '4');
    }
    expect(s.getResults().weight).toBe('62.7');
    expect(s.getResults().bodyFat).toBe('15.8');
  });
});
