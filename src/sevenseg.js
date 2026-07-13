// 7セグメント液晶の数字読み取りエンジン。
// 依存なしの純粋関数群で、Canvas の ImageData（RGBA）または
// グレースケール/二値画像 {width, height, data} を処理する。
//
// パイプライン: RGBA → グレースケール → 適応的二値化 → 桁検出 → セグメント判定

// セグメント配置（ABCDEFG）:
//    AAA
//   F   B
//    GGG
//   E   C
//    DDD
const DIGIT_PATTERNS = {
  '1111110': '0',
  '0110000': '1',
  '1101101': '2',
  '1111001': '3',
  '0110011': '4',
  '1011011': '5',
  '1011111': '6',
  '1110000': '7',
  '1111111': '8',
  '1111011': '9',
};

// 各セグメントのサンプリング領域（桁のバウンディングボックスに対する比率）
const SEGMENT_REGIONS = [
  { x0: 0.15, x1: 0.85, y0: 0.0, y1: 0.18 }, // A
  { x0: 0.65, x1: 1.0, y0: 0.12, y1: 0.45 }, // B
  { x0: 0.65, x1: 1.0, y0: 0.55, y1: 0.88 }, // C
  { x0: 0.15, x1: 0.85, y0: 0.82, y1: 1.0 }, // D
  { x0: 0.0, x1: 0.35, y0: 0.55, y1: 0.88 }, // E
  { x0: 0.0, x1: 0.35, y0: 0.12, y1: 0.45 }, // F
  { x0: 0.15, x1: 0.85, y0: 0.4, y1: 0.6 },  // G
];

const SEGMENT_ON_RATIO = 0.28; // 領域内のインク比がこれ以上なら点灯とみなす

/** RGBA ImageData → グレースケール {width, height, data: Uint8Array} */
export function toGray(imageData) {
  const { width, height, data } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return { width, height, data: gray };
}

/**
 * 適応的二値化（積分画像による局所平均との比較）。
 * 反射型液晶＝明るい背景に暗いセグメントを想定し、
 * 局所平均より一定割合暗い画素をインク(1)とする。
 */
export function binarize(grayImg, { ratio = 0.85 } = {}) {
  const { width: w, height: h, data: gray } = grayImg;
  // 積分画像（幅+1, 高さ+1）
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const win = Math.max(15, Math.floor(Math.min(w, h) / 3)) | 1;
  const half = win >> 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      mask[y * w + x] = gray[y * w + x] < (sum / area) * ratio ? 1 : 0;
    }
  }
  return { width: w, height: h, data: mask };
}

/**
 * 二値画像から桁と小数点の矩形を検出する。
 * 列ごとのインク量を投影し、空白列で区切って桁グループに分ける。
 */
export function findGlyphBoxes(maskImg) {
  const { width: w, height: h, data: mask } = maskImg;
  const colInk = new Uint32Array(w);
  let total = 0;
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) c += mask[y * w + x];
    colInk[x] = c;
    total += c;
  }
  if (total < w * h * 0.005) return []; // ほぼ白紙

  // ノイズしきい値: 1〜2画素のゴマ塩は空白列とみなす
  const noise = Math.max(1, Math.floor(h * 0.02));
  const groups = [];
  let start = -1;
  const maxGap = Math.max(1, Math.floor(w * 0.01)); // 桁内の微小な空白は許容
  let gap = 0;
  for (let x = 0; x < w; x++) {
    const on = colInk[x] > noise;
    if (on) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > maxGap) {
        groups.push([start, x - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) groups.push([start, w - 1]);

  // 各グループの行範囲を求めて矩形化
  const boxes = [];
  for (const [gx0, gx1] of groups) {
    let y0 = h, y1 = -1, area = 0;
    for (let y = 0; y < h; y++) {
      let rowHas = 0;
      for (let x = gx0; x <= gx1; x++) rowHas += mask[y * w + x];
      if (rowHas > 0) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        area += rowHas;
      }
    }
    if (y1 < 0) continue;
    boxes.push({ x0: gx0, x1: gx1, y0, y1, area });
  }
  if (boxes.length === 0) return [];

  // 最大の高さを基準に、まず桁を分類する
  const maxH = Math.max(...boxes.map((b) => b.y1 - b.y0 + 1));
  const digits = boxes.filter((b) => b.y1 - b.y0 + 1 >= maxH * 0.6);
  if (digits.length === 0) return [];
  const digitTop = Math.min(...digits.map((b) => b.y0));
  const digitBottom = Math.max(...digits.map((b) => b.y1));
  const digitH = digitBottom - digitTop + 1;

  // 残りの小さな塊のうち、桁の下側1/3にあるものだけを小数点とみなす
  const result = [];
  for (const b of boxes) {
    const bh = b.y1 - b.y0 + 1;
    const bw = b.x1 - b.x0 + 1;
    if (bh >= maxH * 0.6) {
      result.push({ ...b, type: 'digit' });
    } else if (
      bh <= digitH * 0.3 &&
      bw <= digitH * 0.3 &&
      (b.y0 + b.y1) / 2 > digitTop + digitH * 0.65
    ) {
      result.push({ ...b, type: 'dot' });
    }
    // それ以外（中途半端な高さ）はノイズとして無視
  }
  return result;
}

/** 1桁分の矩形からセグメントパターンを判定して数字を返す（不明なら null） */
export function readDigit(maskImg, box) {
  const { width: w, data: mask } = maskImg;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;

  // 縦棒だけの「1」: 幅が極端に狭い
  if (bw / bh < 0.45) {
    // 箱全体のインク比が高ければ 1
    let ink = 0;
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) ink += mask[y * w + x];
    return ink / (bw * bh) > 0.4 ? '1' : null;
  }

  let pattern = '';
  for (const r of SEGMENT_REGIONS) {
    const sx0 = box.x0 + Math.floor(bw * r.x0);
    const sx1 = box.x0 + Math.ceil(bw * r.x1) - 1;
    const sy0 = box.y0 + Math.floor(bh * r.y0);
    const sy1 = box.y0 + Math.ceil(bh * r.y1) - 1;
    let ink = 0, count = 0;
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        ink += mask[y * w + x];
        count++;
      }
    }
    pattern += ink / count >= SEGMENT_ON_RATIO ? '1' : '0';
  }
  return DIGIT_PATTERNS[pattern] ?? null;
}

/**
 * 二値画像から表示中の数値文字列を読み取る。
 * 戻り値: { text, value } / 読めなければ { text: null, value: null }
 */
export function readDisplay(maskImg) {
  const boxes = findGlyphBoxes(maskImg);
  const digits = boxes.filter((b) => b.type === 'digit');
  if (digits.length === 0 || digits.length > 5) return { text: null, value: null };

  let text = '';
  for (const box of boxes) {
    if (box.type === 'dot') {
      text += '.';
    } else {
      const d = readDigit(maskImg, box);
      if (d == null) return { text: null, value: null };
      text += d;
    }
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return { text: null, value: null };
  return { text, value: Number(text) };
}

/** RGBA ImageData から直接読み取るワンショットAPI */
export function recognizeFrame(imageData) {
  return readDisplay(binarize(toGray(imageData)));
}
