/*** ====== ตั้งค่าตรงนี้ ====== ***/
const CONFIG = {
  API_URL: 'PASTE_YOUR_EXEC_URL_HERE',
  API_KEY: 'CHANGE_ME_TO_RANDOM_STRING_123456'
};

/*** ====== STATE ====== ***/
let S = { user: null, day: null, meters: [], bizDate: '' };
const LS = {
  get s() { try { return JSON.parse(localStorage.getItem('wm_session') || 'null'); } catch (e) { return null; } },
  set s(v) { localStorage.setItem('wm_session', JSON.stringify(v)); },
  get q() { try { return JSON.parse(localStorage.getItem('wm_queue') || '[]'); } catch (e) { return []; } },
  set q(v) { localStorage.setItem('wm_queue', JSON.stringify(v)); }
};

const $ = id => document.getElementById(id);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

/*** ====== API ====== ***/
async function api(action, payload = {}) {
  const body = Object.assign({ action, apiKey: CONFIG.API_KEY }, payload);
  if (S.user) { body.email = S.user.email; body.pin = S.user.pin; }
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'เกิดข้อผิดพลาด');
  return json.data;
}

const busy = on => $('loading').classList.toggle('hidden', !on);
function msg(el, text, kind = 'info') {
  const e = $(el);
  e.textContent = text;
  e.className = 'msg ' + kind;
  if (text) setTimeout(() => { if (e.textContent === text) e.textContent = ''; }, 6000);
}

/*** ====== LOGIN ====== ***/
$('btnLogin').onclick = async () => {
  const email = $('loginEmail').value.trim();
  const pin = $('loginPin').value.trim();
  if (!email || !pin) return msg('loginMsg', 'กรอกอีเมลและ PIN', 'err');
  busy(true);
  try {
    const u = await api('login', { apiKey: CONFIG.API_KEY, email, pin });
    S.user = Object.assign({}, u, { pin });
    LS.s = S.user;
    await start();
  } catch (e) {
    msg('loginMsg', e.message, 'err');
  } finally { busy(false); }
};

$('btnLogout').onclick = () => {
  localStorage.removeItem('wm_session');
  location.reload();
};

/*** ====== START ====== ***/
async function start() {
  const boot = await api('bootstrap');
  S.meters = boot.meters;
  S.bizDate = boot.businessDate;
  $('bizDate').textContent = boot.businessDate;
  $('userName').textContent = S.user.displayName + ' (' + S.user.role + ')';
  $('sumDate').value = boot.businessDate;
  $('hisMeter').innerHTML = '<option value="">ทุกจุด</option>' +
    S.meters.map(m => `<option value="${m.meterId}">${m.meterName}</option>`).join('');
  $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  await loadDay();
  flushQueue();
}

/*** ====== ENTRY ====== ***/
async function loadDay() {
  busy(true);
  try {
    S.day = await api('getDay', { date: S.bizDate });
    renderMeters();
    renderStats(S.day.stats);
  } catch (e) { msg('entryMsg', e.message, 'err'); }
  finally { busy(false); }
}

function renderStats(st) {
  $('stDone').textContent = st.submitted;
  $('stPending').textContent = st.pending;
  $('stAlert').textContent = st.alert;
  $('stUsage').textContent = st.totalUsage;
}

function renderMeters() {
  $('meterList').innerHTML = S.day.items.map(it => {
    if (it.submitted) {
      return `<div class="card done">
        <div class="card-head"><b>${it.meterName}</b><span class="pill ${pillOf(it.status)}">${labelOf(it.status)}</span></div>
        <div class="card-body">
          <div class="kv"><span>เลขเต็ม</span><b>${fmt(it.fullReading, it.digitLength)}</b></div>
          <div class="kv"><span>ใช้ไป</span><b>${it.usageUnits} หน่วย</b></div>
          <div class="kv muted"><span>โดย</span><span>${it.submittedBy}</span></div>
        </div></div>`;
    }
    const isInit = !it.hasBaseline;
    return `<div class="card" data-id="${it.meterId}">
      <div class="card-head">
        <b>${it.meterName}</b>
        <span class="pill ${isInit ? 'init' : 'gray'}">${isInit ? 'ตั้งค่าเริ่มต้น' : 'ครั้งก่อน ' + fmt(it.previousReading, it.digitLength)}</span>
      </div>
      <div class="card-body">
        <div class="input-row">
          <input class="mval" data-id="${it.meterId}" type="tel" inputmode="numeric"
            maxlength="${isInit ? it.digitLength : it.inputDigits}"
            placeholder="${isInit ? 'เลขเต็ม ' + it.digitLength + ' หลัก' : it.inputDigits + ' หลักท้าย'}">
          <label class="fullchk"><input type="checkbox" class="mfull" data-id="${it.meterId}" ${isInit ? 'checked disabled' : ''}> เลขเต็ม</label>
        </div>
        <div class="preview" id="pv-${it.meterId}"></div>
      </div></div>`;
  }).join('');

  document.querySelectorAll('.mval').forEach(el => el.addEventListener('input', onInput));
  document.querySelectorAll('.mfull').forEach(el => el.addEventListener('change', e => {
    const id = e.target.dataset.id;
    const it = S.day.items.find(x => x.meterId === id);
    const inp = document.querySelector(`.mval[data-id="${id}"]`);
    inp.maxLength = e.target.checked ? it.digitLength : it.inputDigits;
    inp.placeholder = e.target.checked ? 'เลขเต็ม ' + it.digitLength + ' หลัก' : it.inputDigits + ' หลักท้าย';
    inp.value = '';
    onInput({ target: inp });
  }));
}

function onInput(e) {
  const id = e.target.dataset.id;
  const it = S.day.items.find(x => x.meterId === id);
  const pv = $('pv-' + id);
  const raw = e.target.value.replace(/\D/g, '');
  e.target.value = raw;
  if (!raw) { pv.innerHTML = ''; return; }

  const isFull = document.querySelector(`.mfull[data-id="${id}"]`).checked;
  let full, usage;
  if (isFull) {
    full = Number(raw);
    usage = it.hasBaseline ? calcUsage(it.previousReading, full, it.digitLength) : 0;
  } else {
    full = computeFull(it.previousReading, Number(raw), it.inputDigits, it.digitLength);
    usage = calcUsage(it.previousReading, full, it.digitLength);
  }
  const over = it.hardLimit && usage > it.hardLimit;
  const warn = !over && it.normalLimit && usage > it.normalLimit;
  pv.className = 'preview ' + (over ? 'critical' : warn ? 'warn' : 'ok');
  pv.innerHTML = `<b>${fmt(full, it.digitLength)}</b> · ใช้ <b>${usage}</b> หน่วย
    ${over ? '⛔ สูงผิดปกติมาก ต้องยืนยัน' : warn ? '🔴 สูงกว่าเกณฑ์ ' + it.normalLimit : '🟢 ปกติ'}`;
}

function computeFull(prev, suffix, digits, digitLength) {
  const base = Math.pow(10, digits), max = Math.pow(10, digitLength);
  let c = Math.floor(prev / base) * base + suffix;
  if (c < prev) c += base;
  if (c >= max) c -= max;
  return c;
}
function calcUsage(prev, full, digitLength) {
  return full >= prev ? full - prev : (Math.pow(10, digitLength) - prev) + full;
}
const fmt = (n, len) => n === null || n === '' ? '-' : String(n).padStart(len || 0, '0');
const pillOf = s => s === 'ALERT' ? 'red' : s === 'REVIEW' ? 'crit' : s === 'INITIAL' ? 'init' : 'green';
const labelOf = s => s === 'ALERT' ? 'สูงกว่าปกติ' : s === 'REVIEW' ? 'ต้องตรวจสอบ' : s === 'INITIAL' ? 'ตั้งต้น' : 'ปกติ';

/*** ====== SUBMIT ====== ***/
$('btnSubmit').onclick = async () => {
  const entries = [];
  document.querySelectorAll('.mval').forEach(inp => {
    const v = inp.value.replace(/\D/g, '');
    if (!v) return;
    const id = inp.dataset.id;
    entries.push({
      readingId: uuid(),
      meterId: id,
      value: v,
      mode: document.querySelector(`.mfull[data-id="${id}"]`).checked ? 'FULL' : 'SUFFIX',
      source: navigator.onLine ? 'ONLINE' : 'OFFLINE_SYNC'
    });
  });
  if (!entries.length) return msg('entryMsg', 'ยังไม่ได้กรอกข้อมูล', 'err');

  if (!navigator.onLine) {
    const q = LS.q; q.push({ date: S.bizDate, entries }); LS.q = q;
    renderQueue();
    return msg('entryMsg', 'บันทึกในเครื่องแล้ว รอส่งเมื่อออนไลน์', 'warn');
  }
  await send(S.bizDate, entries);
};

async function send(date, entries, confirmed = false) {
  busy(true);
  try {
    const r = await api('submitReadings', {
      date, entries: entries.map(e => Object.assign({}, e, { confirmed }))
    });
    const needConfirm = r.results.filter(x => x.needConfirm);
    const failed = r.results.filter(x => !x.ok && !x.needConfirm);

    if (needConfirm.length) {
      const txt = needConfirm.map(x => `• ${nameOf(x.meterId)}: ${x.previewUsage} หน่วย`).join('\n');
      if (confirm('พบค่าสูงกว่าเกณฑ์:\n' + txt + '\n\nยืนยันบันทึกหรือไม่?')) {
        const retry = entries.filter(e => needConfirm.some(n => n.meterId === e.meterId));
        await send(date, retry, true);
      }
    }
    if (failed.length) msg('entryMsg', 'ไม่สำเร็จ: ' + failed.map(f => nameOf(f.meterId) + ' - ' + f.error).join(' | '), 'err');
    else if (r.saved) msg('entryMsg', `บันทึกสำเร็จ ${r.saved} จุด`, 'ok');
    await loadDay();
  } catch (e) {
    msg('entryMsg', e.message, 'err');
  } finally { busy(false); }
}
const nameOf = id => (S.meters.find(m => m.meterId === id) || {}).meterName || id;

/*** ====== OFFLINE QUEUE ====== ***/
function renderQueue() {
  const q = LS.q, bar = $('queueBar');
  bar.classList.toggle('hidden', !q.length);
  if (q.length) bar.textContent = `มี ${q.length} ชุดข้อมูลรอส่ง`;
}
async function flushQueue() {
  if (!navigator.onLine) return;
  const q = LS.q;
  if (!q.length) return;
  LS.q = [];
  for (const batch of q) {
    try { await send(batch.date, batch.entries, true); }
    catch (e) { const cur = LS.q; cur.push(batch); LS.q = cur; }
  }
  renderQueue();
}
window.addEventListener('online', () => { $('netbar').classList.add('hidden'); flushQueue(); });
window.addEventListener('offline', () => $('netbar').classList.remove('hidden'));

/*** ====== SUMMARY & HISTORY ====== ***/
$('btnLoadSum').onclick = async () => {
  busy(true);
  try {
    const d = await api('getDay', { date: $('sumDate').value });
    $('summaryBox').innerHTML = `
      <div class="sumhead">รวม ${d.stats.totalUsage} หน่วย · บันทึก ${d.stats.submitted}/${d.stats.total} · เตือน ${d.stats.alert}</div>` +
      d.items.map(i => `<div class="srow ${i.submitted ? '' : 'pending'}">
        <div class="sname">${i.meterName}</div>
        <div class="snum">${fmt(i.previousReading, 0)} → ${i.fullReading === null ? '—' : fmt(i.fullReading, 0)}</div>
        <div class="suse ${pillOf(i.status)}">${i.usageUnits === null ? '—' : i.usageUnits}</div>
      </div>`).join('');
  } catch (e) { alert(e.message); } finally { busy(false); }
};

$('btnLoadHis').onclick = async () => {
  busy(true);
  try {
    const h = await api('history', { meterId: $('hisMeter').value, limit: 100 });
    $('historyBox').innerHTML = h.rows.map(r => `<div class="srow">
      <div class="sname">${r.date}<br><small>${nameOf(r.meterId)}</small></div>
      <div class="snum">${r.fullReading}</div>
      <div class="suse ${pillOf(r.status)}">${r.usageUnits}</div>
    </div>`).join('') || '<div class="empty">ไม่มีข้อมูล</div>';
  } catch (e) { alert(e.message); } finally { busy(false); }
};

/*** ====== TABS & INIT ====== ***/
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.querySelectorAll('.tabpanel').forEach(p => p.classList.add('hidden'));
  $('tab-' + t.dataset.tab).classList.remove('hidden');
});

(async function init() {
  if (!navigator.onLine) $('netbar').classList.remove('hidden');
  renderQueue();
  const s = LS.s;
  if (s) {
    S.user = s;
    busy(true);
    try { await start(); }
    catch (e) { localStorage.removeItem('wm_session'); }
    finally { busy(false); }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();