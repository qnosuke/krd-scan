// 実機動画から切り出したグレースケールフィクスチャの読み込み。
// フォーマット: gzip圧縮した生輝度値（1byte/px）。既定は 960x540、
// 実機解像度でしか再現しない現象（処理時間の爆発等）は 1920x1080 で保存する。
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';

export const FIXTURE_W = 960;
export const FIXTURE_H = 540;

export function loadGrayFixture(name, width = FIXTURE_W, height = FIXTURE_H) {
  const path = resolve(process.cwd(), 'test/fixtures', name);
  const data = new Uint8Array(gunzipSync(readFileSync(path)));
  if (data.length !== width * height) {
    throw new Error(`fixture ${name}: unexpected size ${data.length}`);
  }
  return { width, height, data };
}
