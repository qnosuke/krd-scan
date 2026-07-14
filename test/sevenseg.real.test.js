// 実機（KRD-203-W）動画フレームでの読み取りテスト。
// フィクスチャはフレーム全体（足・床・ベゼル・ラベル・単位込み）であり、
// 主数字だけを正しく拾えることを検証する。
import { describe, it, expect } from 'vitest';
import { recognizeGray } from '../src/sevenseg.js';
import { loadGrayFixture } from './helpers/loadFixture.js';

// 動画内の表示と正解値（表示順は取説どおりであることも実機で確認済み）
const CASES = [
  ['real_t11.gray.gz', '64.2'], // 体重
  ['real_t13.gray.gz', '20.8'], // 体脂肪率
  ['real_t15.gray.gz', '8'],    // 内臓脂肪レベル
  ['real_t17.gray.gz', '36.2'], // 骨格筋率
  ['real_t19.gray.gz', '41'],   // 体年齢
  ['real_t21.gray.gz', '1538'], // 基礎代謝
  ['real_t23.gray.gz', '22.7'], // BMI
];

describe('実機フレームの読み取り', () => {
  for (const [file, expected] of CASES) {
    it(`${file} → "${expected}"`, () => {
      expect(recognizeGray(loadGrayFixture(file)).text).toBe(expected);
    });
  }

  it('生年月日画面「4:27」を数値として誤読しない', () => {
    // コロンを小数点扱いすると 427 が基礎代謝(385-3999)に誤割当てされるため
    expect(recognizeGray(loadGrayFixture('real_t2.gray.gz')).text).toBeNull();
  });

  it('カメラブレのノイズフレーム(1080p)でも処理時間が爆発しない', () => {
    // t=6.15s のブレたフレームは二値化で成分が3000個超になり、
    // マージ・クラスタ処理がO(n³)だと1フレーム18秒かかって
    // 動画取り込みが止まったように見える（実機で発生した不具合）
    const gray = loadGrayFixture('real_t6noise_1080.gray.gz', 1920, 1080);
    const t0 = performance.now();
    recognizeGray(gray); // 読めなくてよい（nullで構わない）。固まらないことが要件
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
