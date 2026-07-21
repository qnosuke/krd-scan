import { METRICS, validateHumanInput, normalizeHumanInput } from '../metrics.js';
import { addMeasurement, listMeasurements } from '../db.js';
import { previousValue } from '../trend.js';

export function createConfirmView({ onSaved, onDiscarded }) {
  const listEl = document.getElementById('confirm-list');
  const titleEl = document.getElementById('confirm-title');
  const noteEl = document.getElementById('confirm-note');
  const btnSave = document.getElementById('btn-save');
  const btnDiscard = document.getElementById('btn-discard');

  let inputs = {}; // key → input要素
  let manualMode = false;
  let dateInput = null;

  // datetime-local の value 形式（ローカル時刻の YYYY-MM-DDTHH:MM）
  function nowLocalValue() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function render(results, { manual = false } = {}) {
    manualMode = manual;
    dateInput = null;
    titleEl.textContent = manual ? '測定値の手入力' : '測定結果の確認';
    noteEl.textContent = manual
      ? '測定した値を入力してください。空欄は未計測として保存されます。'
      : '読み間違いがないか確認してください。タップで修正できます。';

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

    if (manual) {
      const row = document.createElement('div');
      row.className = 'confirm-datetime';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = '日時';
      dateInput = document.createElement('input');
      dateInput.type = 'datetime-local';
      dateInput.value = nowLocalValue();
      row.append(label, dateInput);
      listEl.appendChild(row);
    }

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
        row.classList.toggle('missing', !validateHumanInput(input.value.trim(), m));
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
    let measuredAt;
    if (manualMode) {
      const t = dateInput?.value ? new Date(dateInput.value) : null;
      if (!t || Number.isNaN(t.getTime())) {
        alert('日時を入力してください');
        return;
      }
      measuredAt = t.toISOString();
    } else {
      measuredAt = new Date().toISOString();
    }
    const record = { measuredAt };
    let hasValue = false;
    for (const m of METRICS) {
      const raw = inputs[m.key]?.value.trim() ?? '';
      if (raw !== '' && !validateHumanInput(raw, m)) {
        alert(`「${m.label}」の値 ${raw} が範囲外です（${m.min}〜${m.max}）`);
        inputs[m.key].focus();
        return;
      }
      record[m.key] = raw === '' ? null : normalizeHumanInput(raw, m);
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
    show(results, opts) {
      render(results ?? {}, opts);
    },
    hide() {},
  };
}
