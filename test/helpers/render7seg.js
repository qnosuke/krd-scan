// テスト用: 7セグ表示の合成画像を生成する（エンジンとは独立の実装）。

const SEGMENTS_BY_CHAR = {
  0: 'ABCDEF',
  1: 'BC',
  2: 'ABDEG',
  3: 'ABCDG',
  4: 'BCFG',
  5: 'ACDFG',
  6: 'ACDEFG',
  7: 'ABC',
  8: 'ABCDEFG',
  9: 'ABCDFG',
};

const CELL_W = 40;
const CELL_H = 70;
const T = 8; // セグメント太さ
const DOT_W = 12;
const GAP = 10;
const MARGIN = 12;

// 各セグメントの矩形 [x0, y0, x1, y1)（セル内座標）
const SEG_RECTS = {
  A: [4, 0, 36, T],
  B: [CELL_W - T, 4, CELL_W, 35],
  C: [CELL_W - T, 35, CELL_W, 66],
  D: [4, CELL_H - T, 36, CELL_H],
  E: [0, 35, T, 66],
  F: [0, 4, T, 35],
  G: [4, 31, 36, 39],
};

/** 表示文字列（例 "62.7"）→ 二値マスク {width, height, data: Uint8Array} */
export function renderMask(text) {
  const glyphs = [...text];
  let width = MARGIN * 2;
  for (const g of glyphs) width += (g === '.' ? DOT_W : CELL_W) + GAP;
  width -= GAP;
  const height = CELL_H + MARGIN * 2;
  const data = new Uint8Array(width * height);

  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) data[y * width + x] = 1;
  };

  let cx = MARGIN;
  for (const g of glyphs) {
    if (g === '.') {
      fill(cx + 2, MARGIN + CELL_H - T, cx + 10, MARGIN + CELL_H);
      cx += DOT_W + GAP;
    } else {
      for (const seg of SEGMENTS_BY_CHAR[g]) {
        const [x0, y0, x1, y1] = SEG_RECTS[seg];
        fill(cx + x0, MARGIN + y0, cx + x1, MARGIN + y1);
      }
      cx += CELL_W + GAP;
    }
  }
  return { width, height, data };
}

/** マスク → グレースケール画像（インク暗・背景明、横方向グラデーションも可） */
export function grayFromMask(mask, { ink = 50, bg = 210, gradient = false } = {}) {
  const { width, height, data } = mask;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = gradient ? bg - 30 + Math.round((60 * x) / width) : bg;
      gray[y * width + x] = data[y * width + x] ? ink : base;
    }
  }
  return { width, height, data: gray };
}

/** マスク → RGBA ImageData 相当オブジェクト */
export function imageDataFromMask(mask, opts) {
  const gray = grayFromMask(mask, opts);
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let i = 0; i < gray.data.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray.data[i];
    rgba[i * 4 + 3] = 255;
  }
  return { width: mask.width, height: mask.height, data: rgba };
}
