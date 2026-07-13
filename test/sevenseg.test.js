import { describe, it, expect } from 'vitest';
import { readDisplay, binarize, recognizeFrame, findGlyphBoxes } from '../src/sevenseg.js';
import { renderMask, grayFromMask, imageDataFromMask } from './helpers/render7seg.js';

// KRD-203 で実際に表示されうる代表値
const SAMPLES = [
  '62.7', '15.8', '4', '39.9', '22', '1545', '20.2',
  '0.0', '100.2', '13', '8.8', '135.4', '3999',
];

describe('readDisplay（二値マスクからの読み取り）', () => {
  for (const text of SAMPLES) {
    it(`"${text}" を読み取れる`, () => {
      const mask = renderMask(text);
      expect(readDisplay(mask).text).toBe(text);
    });
  }

  it('白紙は null', () => {
    const blank = { width: 100, height: 60, data: new Uint8Array(6000) };
    expect(readDisplay(blank).text).toBeNull();
  });

  it('value は数値に変換される', () => {
    expect(readDisplay(renderMask('62.7')).value).toBeCloseTo(62.7);
  });
});

describe('binarize（適応的二値化）', () => {
  it('均一背景でセグメントを抽出できる', () => {
    const mask = renderMask('62.7');
    const gray = grayFromMask(mask);
    expect(readDisplay(binarize(gray)).text).toBe('62.7');
  });

  it('照明ムラ（グラデーション背景）でも読める', () => {
    const mask = renderMask('1545');
    const gray = grayFromMask(mask, { gradient: true });
    expect(readDisplay(binarize(gray)).text).toBe('1545');
  });
});

describe('recognizeFrame（RGBA からのワンショット）', () => {
  it('RGBA画像から読み取れる', () => {
    const img = imageDataFromMask(renderMask('39.9'), { gradient: true });
    expect(recognizeFrame(img).text).toBe('39.9');
  });
});

describe('findGlyphBoxes', () => {
  it('桁と小数点を区別する', () => {
    const boxes = findGlyphBoxes(renderMask('20.2'));
    expect(boxes.map((b) => b.type)).toEqual(['digit', 'digit', 'dot', 'digit']);
  });
});
