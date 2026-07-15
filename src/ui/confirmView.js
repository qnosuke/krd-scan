import { METRICS, validateInput } from '../metrics.js';
import { addMeasurement, listMeasurements } from '../db.js';
import { previousValue } from '../trend.js';

export function createConfirmView({ onSaved, onDiscarded }) {
  const listEl = document.getElementById('confirm-list');
  const btnSave = document.getElementById('btn-save');
  const btnDiscard = document.getElementById('btn-discard');

  let inputs = {}; // key → input要素

  async function render(results) {
    // 前回値: 誤読チェックにも効く（前回と大きく違う値は読み間違いの可能性）
    const prev = {};
    try {
      const records = await listMeasurements();
      for (const m of METRICS) prev[m.key] = previousValue(records, m.key);
    } catch {
      // 前回値が取れなくても確認画面自体は出す
    }

    listEl.innerHTML = '';
    inputs = {};
    for (const m of METRICS) {
      const row = document.createElement('div');
      row.className = 'confirm-row' + (results[m.key] ? '' : ' missing');

      const labelWrap = document.createElement('div');
      labelWrap.className = 'label-wrap';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = m.label;
      labelWrap.appendChild(label);

      if (prev[m.key] != null) {
        const prevEl = document.createElement('span');
        prevEl.className = 'prev';
        prevEl.textContent = `前回 ${prev[m.key].toFixed(m.decimals)}`;
        labelWrap.appendChild(prevEl);
      }

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = results[m.key] ?? '';
      input.placeholder = '未計測';
      input.addEventListener('input', () => {
        row.classList.toggle('missing', !validateInput(input.value.trim(), m));
      });

      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = m.unit;

      row.append(labelWrap, input, unit);
      listEl.appendChild(row);
      inputs[m.key] = input;
    }
  }

  btnSave.addEventListener('click', async () => {
    const record = { measuredAt: new Date().toISOString() };
    let hasValue = false;
    for (const m of METRICS) {
      const raw = inputs[m.key]?.value.trim() ?? '';
      if (raw !== '' && !validateInput(raw, m)) {
        alert(`「${m.label}」の値 ${raw} が範囲外です（${m.min}〜${m.max}）`);
        inputs[m.key].focus();
        return;
      }
      record[m.key] = raw === '' ? null : raw;
      if (raw !== '') hasValue = true;
    }
    if (!hasValue) {
      alert('値がひとつも入っていません');
      return;
    }
    await addMeasurement(record);
    onSaved();
  });

  btnDiscard.addEventListener('click', () => {
    if (confirm('この測定結果を破棄しますか？')) onDiscarded();
  });

  return {
    show(results) {
      render(results ?? {});
    },
    hide() {},
  };
}
