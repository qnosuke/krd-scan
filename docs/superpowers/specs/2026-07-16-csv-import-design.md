# CSVインポート機能 設計書

2026-07-16 / KRD scan

## 目的

自アプリが「履歴」タブから書き出したCSVを読み戻し、記録を復元・移行できるようにする。
想定シナリオ: 機種変更・ブラウザのサイトデータ削除からの復元・別端末への移行。

## ユーザーが確定した要件

| 論点 | 決定 |
|---|---|
| 重複の扱い | **追加マージ**。既存記録は残し、同日時の行はスキップ |
| 入力形式 | **自アプリの書き出し形式のみ**。ヘッダー完全一致・日時 `YYYY-MM-DD HH:MM`。外れたら明示エラー |
| エラー行 | **全か無か**。1行でも不正なら何も取り込まず、何行目がなぜダメかを報告。DBは無傷 |
| UI配置 | **履歴タブ**の「CSVを書き出す」の近くに**控えめな「CSVを読み込む」**（滅多に使わない機能なので目立たせない） |

## 対象フォーマット（エクスポートとの往復整合）

`src/csv.js` の `toCsv()` が書き出す形式をそのまま読む:

```
日時,体重(kg),体脂肪率(%),内臓脂肪(Lv),骨格筋率(%),体年齢(才),基礎代謝(kcal),BMI
2026-07-15 08:30,63.4,22.9,8,34.3,42,1507,22.4
```

- 先頭にBOM（`﻿`）が付いていることがある → 除去して読む
- 改行は `\r\n`（エクスポート時）だが `\n` も受容（`\r?\n` で分割）。末尾の空行は無視
- 値は文字列のまま（DBの保存形式と同じ）。空セル = 未計測（null）
- 引用符・セル内カンマは扱わない（自アプリ形式には存在しないため。YAGNI）

## 重複判定の肝: 分単位の日時キー

エクスポートは日時を**分単位のローカル時刻**に丸めて書き出す（秒・タイムゾーンを落とす）。
DBの `measuredAt` は秒つきISO文字列。よって秒つきISOの完全一致で重複判定すると、
**同じ端末に読み戻したとき重複を検出できず全行が二重登録される**。

対策: 重複キーを「CSVの日時セル形式」に統一する。

- 既存レコード: `formatDate(measuredAt)`（csv.jsの関数と同じ変換）で分単位キーに正規化した集合を作る
- CSV行: 日時セルがそのままキー
- キーが一致した行はスキップ（往復でも「同日時スキップ」が正しく効く）
- 新規追加行の `measuredAt` は、日時セルをローカル時刻としてパースし `Date.toISOString()` でISO化して保存

## アーキテクチャ

採用: **純粋パーサ + 一括DB挿入 + 履歴タブに配線**（検討した「パースとDB挿入の一体化」はテスト困難、
「引用符対応の汎用CSVパーサ」はYAGNIで却下）。

### モジュール構成

```
src/csvImport.js   (新規) パース・検証・重複除外の純関数。DOM/DBに触れない
src/csv.js         (変更) formatDate をexportして csvImport から再利用（往復整合の単一情報源）
src/db.js          (変更) addMeasurements(records) 一括挿入を追加（1トランザクション = 全か無か）
src/ui/historyView.js (変更) ボタンとファイル選択・確認ダイアログ・再描画の配線のみ
index.html         (変更) 履歴タブに「CSVを読み込む」ボタンと hidden な file input
src/styles.css     (変更) 控えめボタン用スタイル（既存 .btn の非primary流用を基本とする）
```

### インターフェース

```js
// src/csvImport.js
/** CSVテキスト → { ok:true, records:[{measuredAt, weight, ...}] }
 *  失敗時 → { ok:false, error:{ line, reason } }（lineは1始まり、ヘッダー行=1） */
export function parseCsvText(text)

/** 分単位日時キーで重複除外 → { fresh:[...], skipped: number } */
export function dedupeByDateKey(records, existingRecords)

// src/db.js
/** 複数レコードを1トランザクションで追加（途中失敗時は全ロールバック） */
export async function addMeasurements(records)
```

### 検証ルール（parseCsvText 内・全か無か）

1. ヘッダー行が `toCsv` の `HEADER` と完全一致（不一致 → 「このアプリが書き出したCSVではないようです」）
2. 各データ行: 列数が8（日時+7項目）
3. 日時セル: `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$` かつ `new Date()` で実在日時になる
4. 各値セル: 空 or `validateInput(text, metric)` を満たす（metrics.jsの既存検証を再利用）
5. どれかに違反 → 即 `{ ok:false, error:{ line, reason } }` を返す（部分取り込みしない）

## UIフロー（historyView.js）

1. 履歴タブ、書き出しボタンの下に控えめな「CSVを読み込む」（`.btn`、primaryなし）
2. タップ → hidden `<input type="file" accept=".csv,text/csv">` を発火
3. `file.text()` で読み込み → `parseCsvText` → 失敗ならalertで「N行目: 理由」を表示して終了
4. `listMeasurements()` → `dedupeByDateKey` → 追加0件なら「すべて登録済みでした（M件重複）」で終了
5. `confirm("N件を追加します（M件は登録済みのためスキップ）。よろしいですか？")`
6. OK → `addMeasurements(fresh)` → 履歴を再描画 → 「N件を追加しました」

## エラー処理まとめ

| 状況 | 挙動 |
|---|---|
| ヘッダー不一致 | 中止。「このアプリが書き出したCSVではないようです」 |
| 行の列数不足/過多・日時破損・値が範囲外 | 中止。「N行目: 理由」。DB無変更 |
| 全行が重複 | 「すべて登録済みでした」。DB無変更 |
| IndexedDB書き込み失敗 | トランザクションごと失敗（部分書き込みなし）。alertで通知 |

## テスト（test/csvImport.test.js ほか）

- **往復テスト**: レコード配列 → `toCsv` → `parseCsvText` → 元の値・分単位日時が一致
- **重複除外**: エクスポート→同じDB内容に対して`dedupeByDateKey` → fresh=0 / 一部新規 → 新規だけ残る
- エラー系: ヘッダー不正・列数不足・日時破損（`2026-13-99 99:99` 等）・範囲外値 → `ok:false` と行番号
- BOMつき・`\n`のみ改行・末尾空行 → 正常パース
- `addMeasurements`: happy-domではIndexedDBが無いためUIスモークはparse層まで。一括挿入はfake-indexeddb不使用の方針に合わせ、既存のPlaywright/実ブラウザ検証で確認

## 制約（変更しない約束事項）

- IndexedDB名 `karadascan`・スキーマは変更しない（`addMeasurements` はストア追加なしのDB_VERSION据え置き）
- データは端末内のみ・外部送信なし・解析なし（ファイルは `file.text()` でローカル処理のみ）
- 依存ライブラリ追加なし
