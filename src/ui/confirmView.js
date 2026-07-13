import { METRICS, validateInput } from '../metrics.js';
import { addMeasurement } from '../db.js';

export function createConfirmView({ onSaved, onDiscarded }) {
  const listEl = document.getElementById('confirm-list');
  const btnSave = document.getElementById('btn-save');
  const btnDiscard = document.getElementById('btn-discard');

  let inputs = {}; // key → input要素

  function render(results) {
    listEl.innerHTML = '';
    inputs = {};
    for (const m of METRICS) {
      const row = document.createElement('div');
      row.className = 'confirm-row' + (results[m.key] ? '' : ' missing');

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = m.label;

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

      row.append(label, input, unit);
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
