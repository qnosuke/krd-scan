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
  '1110010': '7', // KRD-203実機はFセグメント(左上)付きの「7」を表示する
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
export function binarize(grayImg, { ratio = 0.85, window } = {}) {
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
  const win = (window ?? Math.max(15, Math.floor(Math.min(w, h) / 3))) | 1;
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
 * 二値画像の連結成分（8近傍）を矩形リストとして返す。
 * 実機の液晶にはラベル・単位・アイコン・点線・ベゼルの影など
 * 数字以外の塊が多いため、列投影ではなく連結成分で分離する。
 */
export function connectedComponents(maskImg) {
  const { width: w, height: h, data: mask } = maskImg;
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [];
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p / w) | 0;
      area++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    if (area >= 4) comps.push({ x0, x1, y0, y1, area });
    next++;
  }
  return comps;
}

const height = (c) => c.y1 - c.y0 + 1;
const width = (c) => c.x1 - c.x0 + 1;

/**
 * セグメント接合部（ベベル）で縦に分裂した桁部品を再結合する。
 * 実機フォントでは「1」がB/Cの2本のバー、「7」がΓ形+下バーに割れる
 * （隙間は2px程度）。x範囲が強く重なり隙間がごく小さい上下の成分を
 * 1つの矩形にまとめる。点線(横並び)やコロン(隙間が大きい)は結合されない。
 */
export function mergeSplitComponents(comps) {
  // y0昇順に並べてスイープする。マージのたびに全ペアを見直すと
  // ブレたフレーム（成分3000個超）でO(n³)になり動画取り込みが固まるため、
  // 各成分は自分よりy0が下で隙間が届く範囲の相手だけを見る。
  const merged = [...comps].sort((a, b) => a.y0 - b.y0);
  let changed = true;
  while (changed) {
    changed = false;
    let maxH = 0;
    for (const c of merged) maxH = Math.max(maxH, height(c));
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i];
        const b = merged[j];
        // y0昇順なのでこれ以降のbはさらに遠く、隙間条件を満たせない
        if (b.y0 - a.y1 - 1 > (height(a) + maxH) * 0.1) break;
        if (a.y0 >= b.y0 || a.y1 >= b.y1) continue; // a が上、b が下のペアだけ見る
        const gap = b.y0 - a.y1 - 1;
        // 隙間はごく小さいこと。「2」の上フックと下フックのように
        // ボックスが少し重なって分裂する形もあるため、負の隙間も許容する。
        if (gap > (height(a) + height(b)) * 0.1) continue;
        if (gap < -0.35 * Math.min(height(a), height(b))) continue;
        const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
        if (xOverlap < Math.min(width(a), width(b)) * 0.6) continue;
        merged[i] = {
          x0: Math.min(a.x0, b.x0),
          x1: Math.max(a.x1, b.x1),
          y0: a.y0,
          y1: b.y1,
          area: a.area + b.area,
        };
        merged.splice(j, 1);
        changed = true;
        j = i; // 伸びた a に対して続きから相手を探し直す（y0順は保たれる）
      }
    }
  }
  return merged;
}

/**
 * 高さが近く縦位置が強く重なる成分同士を「桁の並び」候補クラスタにまとめ、
 * 背の高いクラスタから順に返す。
 * 画像の縁に接する成分（床・ドア枠・ベゼルの影が「1」に見える）は桁候補にしない。
 */
function digitClusters(comps, imgW, imgH) {
  const candidates = comps
    .filter(
      (c) => height(c) >= 8 && c.x0 > 0 && c.y0 > 0 && c.x1 < imgW - 1 && c.y1 < imgH - 1
    )
    .sort((a, b) => height(b) - height(a));
  // 各候補を一度ずつシードにする。「使用済み」で候補を消し込むと、
  // 背の高い影のクラスタに吸われた桁が二度とクラスタを作れなくなるため、
  // 重複した組だけ除いて全部読み、スコアの良いものを採用する。
  // シードは背の高い順に上限まで: 主数字は常に最大級の成分であり、
  // ブレたフレームの無数の細かい成分まで試すと処理時間が爆発する。
  const clusters = [];
  const seen = new Set();
  for (const seed of candidates.slice(0, 60)) {
    const seedH = height(seed);
    const members = candidates.filter((c) => {
      const ch = height(c);
      if (ch < seedH * 0.7 || ch > seedH * 1.3) return false;
      const overlap = Math.min(c.y1, seed.y1) - Math.max(c.y0, seed.y0) + 1;
      // 同じ表示行の桁は縦位置がほぼ一致する。緩くすると別の高さにある
      // 影が混入してクラスタ全体を壊すため、強い重なりを要求する。
      return overlap >= Math.min(ch, seedH) * 0.75;
    });
    const key = members.map((m) => `${m.x0},${m.y0}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    clusters.push(members.sort((a, b) => a.x0 - b.x0));
  }
  return clusters;
}

/**
 * 桁クラスタ1つを読み取る。クラスタ周辺の小さな塊は
 * ・桁の間かつベースライン付近 → 小数点
 * ・桁の間かつ中段（コロン等） → 読み取り不能として棄却
 * ・桁の外（単位 kg/%/kcal、下のレベル目盛、上の点線） → 無視
 * 戻り値: { text, boxes } / 読めなければ null
 */
function readCluster(maskImg, digits, comps) {
  if (digits.length === 0 || digits.length > 5) return null;

  const top = Math.min(...digits.map((d) => d.y0));
  const bottom = Math.max(...digits.map((d) => d.y1));
  const bandH = bottom - top + 1;
  const xFirst = digits[0].x0;
  const xLast = digits[digits.length - 1].x1;

  const glyphs = [];
  for (const d of digits) {
    const ch = readDigit(maskImg, d);
    if (ch == null) return null; // 1つでも読めない並びは信用しない
    glyphs.push({ ...d, type: 'digit', ch });
  }

  const inCluster = new Set(digits);
  const minDotArea = Math.max(3, bandH * bandH * 0.002);
  for (const c of comps) {
    if (inCluster.has(c)) continue;
    if (c.area < minDotArea || height(c) >= bandH * 0.45) continue;
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    if (cx <= xFirst || cx >= xLast) continue; // 桁の外＝単位などは無視
    // いずれかの桁の箱とx方向で大きく重なる塊は、その桁の分離した
    // セグメント破片（マスク上は箱内なので読み取りには影響しない）
    const isFragment = digits.some((d) => {
      const overlap = Math.min(c.x1, d.x1) - Math.max(c.x0, d.x0) + 1;
      return overlap >= width(c) * 0.5;
    });
    if (isFragment) continue;
    const isDotShaped = height(c) <= bandH * 0.3 && width(c) <= bandH * 0.3;
    if (isDotShaped && cy >= top + bandH * 0.55 && cy <= bottom + bandH * 0.06) {
      glyphs.push({ ...c, type: 'dot', ch: '.' });
    } else if (cy >= top - bandH * 0.05 && cy <= bottom) {
      return null; // 桁の間の中段にある塊（コロン等）→ 数値表示ではない
    }
    // 桁の帯より上下にある塊（点線・レベル目盛）は無視
  }

  glyphs.sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1));
  const text = glyphs.map((g) => g.ch).join('');
  if (!/^\d+(\.\d)?$/.test(text)) return null;
  return { text, boxes: glyphs };
}

/**
 * 読み取りに成功した桁クラスタのうち最良のものを返す（内部共通処理）。
 * 「読めた桁数 × 桁の高さ」をスコアとし、主数字（大きく桁数が多い）を
 * 細長い影などの偶然読める塊より優先する。
 */
function findBestCluster(maskImg) {
  const comps = mergeSplitComponents(connectedComponents(maskImg));
  if (comps.length === 0) return null;
  const clusters = digitClusters(comps, maskImg.width, maskImg.height);
  let best = null;
  let bestScore = 0;
  for (const cluster of clusters.slice(0, 12)) {
    const result = readCluster(maskImg, cluster, comps);
    if (!result) continue;
    const digits = result.boxes.filter((b) => b.type === 'digit');
    const bandH = Math.max(...digits.map((d) => d.y1 - d.y0 + 1));
    const score = digits.length * bandH;
    if (score > bestScore) {
      best = { ...result, score };
      bestScore = score;
    }
  }
  return best;
}

/**
 * 二値画像から桁と小数点の矩形を検出する（読み取りに成功した並びのみ）。
 */
export function findGlyphBoxes(maskImg) {
  return findBestCluster(maskImg)?.boxes ?? [];
}

/** 1桁分の矩形からセグメントパターンを判定して数字を返す（不明なら null） */
export function readDigit(maskImg, box) {
  const { width: w, data: mask } = maskImg;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;

  // 塗り率は成分自身の画素数で評価する（連結成分から来た box には area がある）。
  // マスクを数え直すと、箱に食い込んだ別の成分（暗い液晶パネルの塊など）の
  // 画素まで拾ってしまい、ほぼ空の縦長領域が「1」に化ける。
  let fill;
  if (box.area != null) {
    fill = box.area / (bw * bh);
  } else {
    let ink = 0;
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) ink += mask[y * w + x];
    fill = ink / (bw * bh);
  }

  // 縦棒だけの「1」: 実機フォントの「1」は幅/高さ≈0.14、通常桁は≈0.44。
  // 中間帯(0.25〜0.38)に正規の数字は存在しない（コロンのドット等が入る）。
  // さらに細すぎるもの(高さ/幅>15)はベゼルの縁などの線なので弾く。
  if (bw / bh < 0.38) {
    return bw / bh < 0.25 && fill > 0.4 && bh / bw <= 15 ? '1' : null;
  }
  // 幅広すぎる塊（漢字ラベル・アイコン）やベタ塗り（影）は数字ではない
  if (bw / bh > 0.7 || fill > 0.75) return null;

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
    const segRatio = ink / count;
    // 本物の7セグ数字はセグメント比が二極化する（実測: 消灯≤0.26 / 点灯≥0.56）。
    // 漢字ラベル等は0.4〜0.5の中間値になるため、中間帯は数字ではないと判断する。
    if (segRatio > 0.32 && segRatio < 0.5) return null;
    pattern += segRatio >= SEGMENT_ON_RATIO ? '1' : '0';
  }
  return DIGIT_PATTERNS[pattern] ?? null;
}

/**
 * 二値画像から表示中の数値文字列を読み取る。
 * 戻り値: { text, value } / 読めなければ { text: null, value: null }
 */
export function readDisplay(maskImg) {
  const result = findBestCluster(maskImg);
  if (!result) return { text: null, value: null };
  return { text: result.text, value: Number(result.text) };
}

/**
 * グレースケール画像から読み取る。二値化窓を2スケール試す:
 * 大きい窓は数字がフレームの大半を占める場合（ガイド枠ROI）向け、
 * 小さい窓は液晶が画面の一部でしかない場合（フレーム全体・動画取り込み）向け。
 * 大窓だと暗い液晶パネル全体が1つの黒塊になり数字が埋まってしまう。
 */
export function recognizeGray(grayImg) {
  const minSide = Math.min(grayImg.width, grayImg.height);
  const windows = [
    Math.max(15, Math.floor(minSide / 3)),
    Math.max(25, Math.floor(minSide / 12)),
  ];
  let best = null;
  for (const window of windows) {
    const result = findBestCluster(binarize(grayImg, { window }));
    if (result && (!best || result.score > best.score)) best = result;
  }
  if (!best) return { text: null, value: null };
  return { text: best.text, value: Number(best.text) };
}

/** RGBA ImageData から直接読み取るワンショットAPI */
export function recognizeFrame(imageData) {
  return recognizeGray(toGray(imageData));
}
