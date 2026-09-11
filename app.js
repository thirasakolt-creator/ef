/*** ══════════ ตั้งค่า (แก้ 2 บรรทัดนี้) ══════════ ***/
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyFArEf2z7QtIHYU1oHpcfTUA-AKRI82ymgUMKhZJJOFQFLJltpNRm9_xfxcsaiUMMD/exec',
  API_KEY: 'omoover011'
};

/*** ══════════ STATE ══════════ ***/
const S = {
  user: null, day: null, meters: [],
  bizDate: '', viewDate: '',
  openId: null,          // การ์ดที่เปิดอยู่ (ทีละ 1)
  openMode: 'NEW',       // NEW | EDIT | UNLOCK
  reportData: null, reportBlob: null
};

let deferredPrompt = null;

const LS = {
  get s() { try { return JSON.parse(localStorage.getItem('wm_session') || 'null'); } catch (e) { return null; } },
  set s(v) { localStorage.setItem('wm_session', JSON.stringify(v)); },
  get q() { try { return JSON.parse(localStorage.getItem('wm_queue') || '[]'); } catch (e) { return []; } },
  set q(v) { localStorage.setItem('wm_queue', JSON.stringify(v)); }
};

const $ = id => document.getElementById(id);
const isAdmin = () => !!(S.user && S.user.role === 'ADMIN');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

const fmt = (n, len) => (n === null || n === '' || n === undefined) ? '-' : String(n).padStart(len || 0, '0');
const pillOf = s => s === 'ALERT' ? 'red' : s === 'REVIEW' ? 'crit' : s === 'INITIAL' ? 'init' : 'green';
const nameOf = id => { const m = S.meters.find(x => x.meterId === id); return m ? m.meterName : id; };
const itemOf = id => S.day.items.find(x => x.meterId === id);

function busy(on) { $('loading').classList.toggle('hidden', !on); }

function msg(el, text, kind) {
  const e = $(el);
  if (!e) return;
  e.textContent = text;
  e.className = 'msg ' + (kind || 'info');
  if (text) setTimeout(() => { if (e.textContent === text) e.textContent = ''; }, 7000);
}

/*** ══════════ API ══════════ ***/
async function api(action, payload) {
  const body = Object.assign({ action: action, apiKey: CONFIG.API_KEY }, payload || {});
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

/*** ══════════ MATH ══════════ ***/
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

/*** ══════════ LOGIN ══════════ ***/
$('btnLogin').onclick = async function () {
  const email = $('loginEmail').value.trim();
  const pin = $('loginPin').value.trim();
  if (!email || !pin) return msg('loginMsg', 'กรุณากรอกอีเมลและ PIN', 'err');
  busy(true);
  try {
    const u = await api('login', { email: email, pin: pin });
    S.user = Object.assign({}, u, { pin: pin });
    LS.s = S.user;
    await start();
  } catch (e) { msg('loginMsg', e.message, 'err'); }
  finally { busy(false); }
};

$('loginPin').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });
$('btnLogout').onclick = function () { localStorage.removeItem('wm_session'); location.reload(); };

/*** ══════════ START ══════════ ***/
async function start() {
  const boot = await api('bootstrap');
  S.meters = boot.meters;
  S.bizDate = boot.businessDate;
  S.viewDate = boot.businessDate;

  $('bizDate').textContent = boot.businessDate;
  $('userName').textContent = S.user.displayName + ' (' + S.user.role + ')';
  $('sumDate').value = boot.businessDate;
  $('entryDate').value = boot.businessDate;
  $('resetDate').value = boot.businessDate;
  $('hisMeter').innerHTML = '<option value="">ทุกจุด</option>' +
    S.meters.map(m => '<option value="' + m.meterId + '">' + m.meterName + '</option>').join('');

  if (isAdmin()) {
    $('tabAdminBtn').classList.remove('hidden');
    $('adminDateBox').classList.remove('hidden');
  }

  $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  await loadDay();
  flushQueue();
}

/*** ══════════ LOAD DAY ══════════ ***/
async function loadDay(keepOpen) {
  busy(true);
  try {
    S.day = await api('getDay', { date: S.viewDate });
    if (!keepOpen) { S.openId = null; S.openMode = 'NEW'; }
    renderMeters();
    renderProgress(S.day.stats);
  } catch (e) { msg('entryMsg', e.message, 'err'); }
  finally { busy(false); }
}

function renderProgress(st) {
  $('stDone').textContent = st.submitted;
  $('stTotal').textContent = st.total;
  $('stPending').textContent = st.pending;
  $('stAlert').textContent = st.alert;
  const pct = st.total ? Math.round(st.submitted / st.total * 100) : 0;
  $('progFill').style.width = pct + '%';
}

$('btnLoadEntryDate').onclick = async function () {
  S.viewDate = $('entryDate').value || S.bizDate;
  await loadDay();
};
$('btnTodayEntry').onclick = async function () {
  S.viewDate = S.bizDate;
  $('entryDate').value = S.bizDate;
  await loadDay();
};

/*** ══════════ RENDER: การ์ดคอลัมน์เดียว + Dropdown ══════════ ***/
function renderMeters() {
  const back = S.viewDate !== S.bizDate;
  let h = back ? '<div class="backdate">📅 กำลังดูวันที่ ' + S.viewDate + '</div>' : '';
  h += S.day.items.map(function (it, i) { return cardHtml(it, i); }).join('');
  $('meterList').innerHTML = h;

  const inp = document.querySelector('.mc-input');
  if (inp) { inp.addEventListener('input', onCardInput); setTimeout(() => inp.focus(), 60); }
  const chk = document.querySelector('.mc-full');
  if (chk) chk.addEventListener('change', onFullToggle);
}

function cardHtml(it, idx) {
  const id = it.meterId;
  const open = S.openId === id;
  const mode = open ? S.openMode : null;
  const locked = it.submitted && !open;

  let cls = 'mcard';
  if (open) cls += ' open';
  if (it.submitted) cls += ' saved';
  if (mode === 'EDIT') cls += ' m-edit';
  if (mode === 'UNLOCK') cls += ' m-unlock';

  /* ── หัวการ์ด ── */
  let right = '';
  if (it.submitted) {
    right = '<span class="mc-val">' + fmt(it.fullReading, it.digitLength) + '</span>';
    if (isAdmin() && !open) {
      right += '<button class="mc-ab" data-act="edit" data-id="' + id + '" title="แก้ไขเลข">✏️</button>' +
               '<button class="mc-ab" data-act="unlock" data-id="' + id + '" title="ปลดล็อกบันทึกใหม่">🔓</button>';
    }
    if (open) right += '<button class="mc-ab" data-act="close" data-id="' + id + '">✕</button>';
  } else {
    right = '<span class="mc-wait">' + (it.hasBaseline ? 'รอบันทึก' : 'ตั้งต้น') + '</span>' +
            '<span class="mc-arrow">' + (open ? '▲' : '▼') + '</span>';
  }

  let html = '<div class="' + cls + '">';
  html += '<div class="mc-head"' + (locked ? '' : ' data-act="toggle" data-id="' + id + '"') + '>' +
            '<span class="mc-no">' + (idx + 1) + '</span>' +
            '<div class="mc-title"><b>' + it.meterName + '</b>' +
              (it.location ? '<small>' + it.location + '</small>' : '') +
            '</div>' +
            '<div class="mc-right">' + right + '</div>' +
          '</div>';

  /* ── เนื้อหา Dropdown ── */
  if (open) {
    const isInit = !it.hasBaseline;
    let hint = '', prefix = '', value = '', maxlen = it.inputDigits, btnText = 'บันทึก';

    if (mode === 'EDIT') {
      prefix = String(Math.floor(it.fullReading / Math.pow(10, it.inputDigits)));
      value = it.inputValue;
      hint = 'โหมดแก้ไข — หลักหน้า <b>' + prefix + '</b> คงเดิม ไม่รันเพิ่ม';
      btnText = 'บันทึกการแก้ไข';
    } else if (mode === 'UNLOCK') {
      hint = 'โหมดปลดล็อก — ฐานคำนวณ <b>' + fmt(it.fullReading, it.digitLength) + '</b> หลักหน้ารันเพิ่มปกติ';
      btnText = 'บันทึกรอบใหม่';
    } else if (isInit) {
      maxlen = it.digitLength;
      hint = 'ครั้งแรก — กรอกเลขเต็ม ' + it.digitLength + ' หลัก';
    } else {
      hint = 'ครั้งก่อน <b>' + fmt(it.previousReading, it.digitLength) + '</b> · กรอก ' + it.inputDigits + ' หลักท้าย';
    }

    html += '<div class="mc-body">' +
              '<div class="mc-hint">' + hint + '</div>' +
              '<div class="mc-inrow">' +
                (mode === 'EDIT' ? '<span class="mc-prefix">' + prefix + '</span>' : '') +
                '<input class="mc-input" data-id="' + id + '" data-mode="' + mode + '" type="tel" ' +
                  'inputmode="numeric" maxlength="' + maxlen + '" value="' + value + '" ' +
                  'placeholder="' + (maxlen > 3 ? 'เลขเต็ม' : maxlen + ' หลัก') + '">' +
                '<button class="btn primary mc-save" data-act="save" data-id="' + id + '">' + btnText + '</button>' +
              '</div>';

    if (mode === 'NEW' && !isInit) {
      html += '<label class="mc-fullchk"><input type="checkbox" class="mc-full" data-id="' + id + '"> กรอกเลขเต็มแทน</label>';
    }
    html += '<div class="mc-preview" id="pv-' + id + '"></div>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/*** ══════════ CLICK HANDLER ══════════ ***/
$('meterList').addEventListener('click', function (e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;

  if (act === 'toggle') {
    const it = itemOf(id);
    if (it.submitted) return;
    if (S.openId === id) { S.openId = null; }
    else { S.openId = id; S.openMode = 'NEW'; }
    renderMeters();
  }
  else if (act === 'edit')   { S.openId = id; S.openMode = 'EDIT';   renderMeters(); }
  else if (act === 'unlock') { S.openId = id; S.openMode = 'UNLOCK'; renderMeters(); }
  else if (act === 'close')  { S.openId = null; renderMeters(); }
  else if (act === 'save')   { saveCard(id); }
});

function onFullToggle(e) {
  const id = e.target.dataset.id;
  const it = itemOf(id);
  const inp = document.querySelector('.mc-input');
  inp.maxLength = e.target.checked ? it.digitLength : it.inputDigits;
  inp.placeholder = e.target.checked ? 'เลขเต็ม' : it.inputDigits + ' หลัก';
  inp.value = '';
  inp.dataset.full = e.target.checked ? '1' : '';
  onCardInput({ target: inp });
  inp.focus();
}

/*** ══════════ PREVIEW ══════════ ***/
function onCardInput(e) {
  const inp = e.target;
  const id = inp.dataset.id, mode = inp.dataset.mode;
  const it = itemOf(id);
  const pv = $('pv-' + id);
  const raw = inp.value.replace(/\D/g, '');
  inp.value = raw;
  if (!raw) { pv.innerHTML = ''; pv.className = 'mc-preview'; return; }

  let full, usage, bad = false;

  if (mode === 'EDIT') {
    const b = Math.pow(10, it.inputDigits);
    full = Math.floor(it.fullReading / b) * b + Number(raw);
    usage = full - it.previousReading;
    bad = usage < 0;
  } else {
    const base = mode === 'UNLOCK' ? it.fullReading : it.previousReading;
    const useFull = inp.dataset.full === '1' || !it.hasBaseline;
    if (useFull) {
      full = Number(raw);
      usage = it.hasBaseline ? calcUsage(base, full, it.digitLength) : 0;
    } else {
      full = computeFull(base, Number(raw), it.inputDigits, it.digitLength);
      usage = calcUsage(base, full, it.digitLength);
    }
  }

  const over = !bad && it.hardLimit && usage > it.hardLimit;
  const warn = !bad && !over && it.normalLimit && usage > it.normalLimit;
  pv.className = 'mc-preview ' + (bad || over ? 'critical' : warn ? 'warn' : 'ok');
  pv.innerHTML = '<b>' + fmt(full, it.digitLength) + '</b> · ใช้ <b>' + usage + '</b> หน่วย ' +
    (bad ? '⛔ ติดลบ ตรวจสอบอีกครั้ง'
         : over ? '⛔ สูงผิดปกติมาก'
         : warn ? '🔴 สูงกว่าเกณฑ์ ' + it.normalLimit
         : '🟢 ปกติ');
}

/*** ══════════ SAVE ทีละการ์ด ══════════ ***/
async function saveCard(id) {
  const it = itemOf(id);
  const inp = document.querySelector('.mc-input');
  const raw = inp.value.replace(/\D/g, '');
  if (!raw) return msg('entryMsg', 'กรุณากรอกตัวเลข', 'err');
  const mode = inp.dataset.mode;

  /* ── โหมดแก้ไข ── */
  if (mode === 'EDIT') {
    busy(true);
    try {
      const r = await api('editReading', { readingId: it.readingId, value: raw, mode: 'SUFFIX' });
      S.openId = null;
      msg('entryMsg', it.meterName + ': แก้เป็น ' + r.fullReading + ' (' + r.usageUnits + ' หน่วย)', 'ok');
      await loadDay();
    } catch (e) { msg('entryMsg', e.message, 'err'); }
    finally { busy(false); }
    return;
  }

  /* ── โหมดบันทึกใหม่ / ปลดล็อก ── */
  const entry = {
    readingId: uuid(),
    meterId: id,
    value: raw,
    mode: (inp.dataset.full === '1' || !it.hasBaseline) ? 'FULL' : 'SUFFIX',
    force: mode === 'UNLOCK',
    source: navigator.onLine ? 'ONLINE' : 'OFFLINE_SYNC'
  };

  if (!navigator.onLine) {
    const q = LS.q;
    q.push({ date: S.viewDate, entries: [entry] });
    LS.q = q;
    S.openId = null;
    renderQueue();
    renderMeters();
    return msg('entryMsg', 'บันทึกในเครื่องแล้ว รอส่งเมื่อออนไลน์', 'warn');
  }

  await sendEntries(S.viewDate, [entry], false);
}

async function sendEntries(date, entries, confirmed) {
  busy(true);
  try {
    const r = await api('submitReadings', {
      date: date,
      entries: entries.map(e => Object.assign({}, e, { confirmed: !!confirmed }))
    });

    const need = r.results.filter(x => x.needConfirm);
    const fail = r.results.filter(x => !x.ok && !x.needConfirm);

    if (need.length) {
      const txt = need.map(x => nameOf(x.meterId) + ': ' + x.previewUsage + ' หน่วย').join('\n');
      busy(false);
      if (confirm('ค่าสูงกว่าเกณฑ์\n\n' + txt + '\n\nยืนยันบันทึกหรือไม่?')) {
        return await sendEntries(date, entries, true);
      }
      return;
    }

    if (fail.length) {
      msg('entryMsg', fail.map(f => nameOf(f.meterId) + ' — ' + f.error).join(' | '), 'err');
    } else if (r.saved) {
      const ok = r.results.filter(x => x.ok)[0];
      msg('entryMsg', '✅ ' + nameOf(ok.meterId) + ' บันทึกแล้ว · ' + ok.fullReading +
                      ' (' + ok.usageUnits + ' หน่วย)', 'ok');
      S.openId = null;
    }
    await loadDay(true);
  } catch (e) { msg('entryMsg', e.message, 'err'); }
  finally { busy(false); }
}

/*** ══════════ OFFLINE QUEUE ══════════ ***/
function renderQueue() {
  const q = LS.q, bar = $('queueBar');
  bar.classList.toggle('hidden', !q.length);
  if (q.length) bar.textContent = 'มี ' + q.length + ' รายการรอส่ง';
}

async function flushQueue() {
  if (!navigator.onLine) return;
  const q = LS.q;
  if (!q.length) return;
  LS.q = [];
  for (const b of q) {
    try { await sendEntries(b.date, b.entries, true); }
    catch (e) { const c = LS.q; c.push(b); LS.q = c; }
  }
  renderQueue();
}

window.addEventListener('online', function () { $('netbar').classList.add('hidden'); flushQueue(); });
window.addEventListener('offline', function () { $('netbar').classList.remove('hidden'); });

/*** ══════════ ADMIN: ปลดล็อกทั้งวัน ══════════ ***/
$('btnResetDay').onclick = async function () {
  const date = $('resetDate').value;
  if (!date) return msg('resetMsg', 'กรุณาเลือกวันที่', 'err');

  busy(true);
  let count = 0;
  try {
    const d = await api('getDay', { date: date });
    count = d.stats.submitted;
  } catch (e) { busy(false); return msg('resetMsg', e.message, 'err'); }
  busy(false);

  if (!count) return msg('resetMsg', 'วันที่ ' + date + ' ไม่มีข้อมูลที่ต้องล้าง', 'warn');

  /* ยืนยันรอบที่ 1 */
  if (!confirm('ปลดล็อกทั้งวัน\n\nวันที่: ' + date + '\nข้อมูลที่จะถูกล้าง: ' + count + ' จุด\n\nดำเนินการต่อหรือไม่?')) return;

  /* ยืนยันรอบที่ 2 */
  $('rmDate').textContent = date;
  $('rmCount').textContent = count;
  $('rmText').value = '';
  $('rmMsg').textContent = '';
  $('resetModal').classList.remove('hidden');
  setTimeout(() => $('rmText').focus(), 100);
};

$('rmClose').onclick = function () { $('resetModal').classList.add('hidden'); };

$('rmGo').onclick = async function () {
  const txt = $('rmText').value.trim();
  if (txt !== 'ยืนยัน') return msg('rmMsg', 'กรุณาพิมพ์คำว่า ยืนยัน ให้ถูกต้อง', 'err');

  const date = $('resetDate').value;
  busy(true);
  try {
    const r = await api('voidDay', { date: date, confirmText: 'ยืนยัน' });
    $('resetModal').classList.add('hidden');
    msg('resetMsg', '✅ ล้างข้อมูลวันที่ ' + r.date + ' แล้ว ' + r.cleared + ' รายการ', 'ok');
    if (S.viewDate === date) { S.openId = null; await loadDay(); }
  } catch (e) { msg('rmMsg', e.message, 'err'); }
  finally { busy(false); }
};

/*** ══════════ REPORT ══════════ ***/
$('btnLoadSum').onclick = loadSummaryReport;
$('optPad').onchange = function () { if (S.reportData) renderSummaryPreview(S.reportData); };
$('optUsage').onchange = function () { if (S.reportData) renderSummaryPreview(S.reportData); };

async function loadSummaryReport() {
  const date = $('sumDate').value;
  if (!date) return msg('summaryMsg', 'กรุณาเลือกวันที่', 'err');
  busy(true);
  try {
    const d = await api('getDay', { date: date });
    S.reportData = d;
    $('imgBox').classList.add('hidden');
    renderSummaryPreview(d);
    msg('summaryMsg', 'โหลดข้อมูลแล้ว กด "สร้างรูปภาพรายงาน" เพื่อทำรูปส่ง LINE', 'ok');
  } catch (e) { msg('summaryMsg', e.message, 'err'); }
  finally { busy(false); }
}

function readingText(it) {
  if (it.fullReading === null || it.fullReading === undefined) return '';
  return $('optPad').checked ? fmt(it.fullReading, it.digitLength) : String(it.fullReading);
}

function thaiHeaderDate(dateStr) {
  const p = String(dateStr).split('-');
  return { d: String(Number(p[2])), m: String(Number(p[1])), y: String((Number(p[0]) + 543) % 100).padStart(2, '0') };
}

function renderSummaryPreview(d) {
  const showUsage = $('optUsage').checked;
  const t = thaiHeaderDate(d.date);
  const round = $('sumRound').value;

  let h = '<div class="rp">';
  h += '<div class="rp-date"><span>วันที่</span><b>' + t.d + '</b><span>/</span><b>' + t.m + '</b><span>/</span><b>' + t.y + '</b></div>';
  h += '<div class="rp-title">มิเตอร์น้ำ' + (round ? ' (' + round + ')' : '') + '</div>';
  h += '<div class="rp-row rp-head' + (showUsage ? ' u' : '') + '">' +
        '<div></div><div>จุดที่ตั้งมิเตอร์</div><div>จุดที่ใช้น้ำ</div><div>เลขมิเตอร์</div>' +
        (showUsage ? '<div>ใช้ไป</div>' : '') + '</div>';

  d.items.forEach(function (it, i) {
    const cls = it.status === 'REVIEW' ? ' rp-crit' : it.status === 'ALERT' ? ' rp-alert' : '';
    h += '<div class="rp-row' + (showUsage ? ' u' : '') + cls + '">' +
          '<div class="rp-no">' + (i + 1) + '</div>' +
          '<div class="rp-nm">' + it.meterName + '</div>' +
          '<div class="rp-lc">' + (it.location || '') + '</div>' +
          '<div class="rp-nu">' + readingText(it) + '</div>' +
          (showUsage ? '<div class="rp-us">' + (it.usageUnits !== null ? it.usageUnits : '') + '</div>' : '') +
        '</div>';
  });

  h += '</div>';
  h += '<div class="rp-sum">บันทึกแล้ว ' + d.stats.submitted + '/' + d.stats.total +
       ' · รวม ' + d.stats.totalUsage + ' หน่วย' +
       (d.stats.alert ? ' · ⚠️ ผิดปกติ ' + d.stats.alert + ' จุด' : '') + '</div>';

  $('summaryWrap').innerHTML = h;
}

$('btnMakeImg').onclick = async function () {
  if (!S.reportData) return msg('summaryMsg', 'กรุณากด "ดูรายงาน" ก่อน', 'err');
  busy(true);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = drawReportCanvas(S.reportData);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png', 1));
    S.reportBlob = blob;
    $('reportImg').src = URL.createObjectURL(blob);
    $('imgBox').classList.remove('hidden');
    $('imgBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    msg('summaryMsg', 'สร้างรูปเรียบร้อย', 'ok');
  } catch (e) { msg('summaryMsg', 'สร้างรูปไม่สำเร็จ: ' + e.message, 'err'); }
  finally { busy(false); }
};

function fitFont(ctx, text, maxW, size, weight) {
  let s = size;
  const fam = '"Noto Sans Thai","Sarabun","Segoe UI",sans-serif';
  ctx.font = weight + ' ' + s + 'px ' + fam;
  while (ctx.measureText(text).width > maxW && s > 11) {
    s -= 1;
    ctx.font = weight + ' ' + s + 'px ' + fam;
  }
  return s;
}

function drawReportCanvas(d) {
  const showUsage = $('optUsage').checked;
  const round = $('sumRound').value;
  const items = d.items;
  const t = thaiHeaderDate(d.date);

  const SC = 2;
  const W = showUsage ? 1060 : 960;
  const PAD = 16;
  const hDate = 62, hTitle = 50, hHead = 54, hRow = 48, hFoot = 44;
  const H = PAD * 2 + hDate + hTitle + hHead + hRow * items.length + hFoot;

  const cv = $('reportCanvas');
  cv.width = W * SC; cv.height = H * SC;
  const x = cv.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.scale(SC, SC);
  x.textBaseline = 'middle';

  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);

  const L = PAD, R = W - PAD, IW = R - L;
  const cols = showUsage ? [70, 300, 300, 210, 180] : [70, 340, 340, 210];
  const sum = cols.reduce((a, b) => a + b, 0);
  const cw = cols.map(c => c / sum * IW);
  const cx = [L];
  for (let i = 0; i < cw.length; i++) cx.push(cx[i] + cw[i]);

  const line = (x1, y1, x2, y2, lw) => {
    x.strokeStyle = '#fff'; x.lineWidth = lw || 1.6;
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
  };

  let y = PAD;

  x.strokeStyle = '#fff'; x.lineWidth = 3;
  x.strokeRect(L, y, IW, hDate);
  const my = y + hDate / 2;
  x.fillStyle = '#fff'; x.textAlign = 'left';
  x.font = 'bold 30px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText('วันที่', L + 14, my);
  x.textAlign = 'center';
  x.font = 'bold 32px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText(t.d, L + IW * 0.34, my);
  x.fillText('/', L + IW * 0.44, my);
  x.fillText(t.m, L + IW * 0.54, my);
  x.fillText('/', L + IW * 0.76, my);
  x.fillText(t.y, L + IW * 0.86, my);
  y += hDate;

  x.strokeRect(L, y, IW, hTitle);
  x.textAlign = 'center';
  x.font = 'bold 28px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText('มิเตอร์น้ำ' + (round ? ' (' + round + ')' : ''), L + IW / 2, y + hTitle / 2);
  y += hTitle;

  const headTop = y;
  x.strokeRect(L, y, IW, hHead);
  const heads = showUsage
    ? ['', 'จุดที่ตั้งมิเตอร์', 'จุดที่ใช้น้ำ', 'เลขมิเตอร์', 'ใช้ไป']
    : ['', 'จุดที่ตั้งมิเตอร์', 'จุดที่ใช้น้ำ', 'เลขมิเตอร์'];
  heads.forEach(function (h, i) {
    if (!h) return;
    const s = fitFont(x, h, cw[i] - 16, 26, 'bold');
    x.font = 'bold ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.textAlign = 'center';
    x.fillText(h, cx[i] + cw[i] / 2, y + hHead / 2);
  });
  for (let i = 1; i < cx.length - 1; i++) line(cx[i], headTop, cx[i], headTop + hHead, 2);
  y += hHead;

  items.forEach(function (it, idx) {
    const top = y;
    x.strokeStyle = '#fff'; x.lineWidth = 1.6;
    x.strokeRect(L, top, IW, hRow);
    for (let i = 1; i < cx.length - 1; i++) line(cx[i], top, cx[i], top + hRow, 1.6);
    const cy = top + hRow / 2;

    x.fillStyle = '#fff'; x.textAlign = 'center';
    x.font = '25px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(String(idx + 1), cx[0] + cw[0] / 2, cy);

    let s = fitFont(x, it.meterName, cw[1] - 18, 25, '600');
    x.font = '600 ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(it.meterName, cx[1] + cw[1] / 2, cy);

    const loc = it.location || '';
    s = fitFont(x, loc, cw[2] - 18, 25, '600');
    x.font = '600 ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(loc, cx[2] + cw[2] / 2, cy);

    const num = readingText(it);
    x.fillStyle = (it.status === 'ALERT' || it.status === 'REVIEW') ? '#ff8f8f' : '#fff';
    s = fitFont(x, num, cw[3] - 18, 30, 'bold');
    x.font = 'bold ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(num, cx[3] + cw[3] / 2, cy);

    if (showUsage) {
      x.fillStyle = (it.status === 'ALERT' || it.status === 'REVIEW') ? '#ff8f8f' : '#c9d4e3';
      x.font = '600 24px "Noto Sans Thai","Sarabun",sans-serif';
      x.fillText(it.usageUnits !== null ? String(it.usageUnits) : '', cx[4] + cw[4] / 2, cy);
    }
    y += hRow;
  });

  x.fillStyle = '#9aa7b5';
  x.textAlign = 'left';
  x.font = '20px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText('บันทึก ' + d.stats.submitted + '/' + d.stats.total +
             ' · รวม ' + d.stats.totalUsage + ' หน่วย', L + 4, y + hFoot / 2);
  x.textAlign = 'right';
  x.fillText(new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }), R - 4, y + hFoot / 2);

  return cv;
}

function reportFileName() {
  const r = $('sumRound').value;
  return 'meter_' + $('sumDate').value + (r ? '_' + r : '') + '.png';
}

$('btnShareImg').onclick = async function () {
  if (!S.reportBlob) return;
  const file = new File([S.reportBlob], reportFileName(), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'รายงานมิเตอร์น้ำ ' + $('sumDate').value }); }
    catch (e) {}
  } else {
    alert('อุปกรณ์นี้ยังไม่รองรับการแชร์ไฟล์โดยตรง\n\nกรุณากด "บันทึกรูป" แล้วส่งเข้า LINE จากคลังภาพแทนครับ');
  }
};

$('btnDownImg').onclick = function () {
  if (!S.reportBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(S.reportBlob);
  a.download = reportFileName();
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

/*** ══════════ HISTORY ══════════ ***/
$('btnLoadHis').onclick = async function () {
  busy(true);
  try {
    const h = await api('history', { meterId: $('hisMeter').value, limit: 120 });
    $('historyBox').innerHTML = h.rows.map(r =>
      '<div class="srow">' +
        '<div class="sname">' + r.date + '<br><small>' + (r.meterName || nameOf(r.meterId)) + '</small></div>' +
        '<div class="snum">' + r.fullReading + '</div>' +
        '<div class="suse ' + pillOf(r.status) + '">' + r.usageUnits + '</div>' +
      '</div>').join('') || '<div class="empty">ไม่มีข้อมูล</div>';
  } catch (e) { alert(e.message); } finally { busy(false); }
};

/*** ══════════ ADMIN: USERS ══════════ ***/
async function loadUsers() {
  busy(true);
  try {
    const r = await api('listUsers');
    $('userList').innerHTML = r.users.map(u =>
      '<div class="ucard' + (u.active ? '' : ' off') + '">' +
        '<div class="uc-head"><b>' + (u.displayName || u.email) + '</b>' +
        '<span class="pill ' + (u.role === 'ADMIN' ? 'red' : u.role === 'RECORDER' ? 'green' : 'gray') + '">' + u.role + '</span></div>' +
        '<div class="uc-mail">' + u.email + ' · ' + (u.active ? '🟢 ใช้งาน' : '⚪ ปิด') + '</div>' +
        '<div class="row admin-actions">' +
          '<button class="btn small" data-uact="edit" data-email="' + u.email + '">✏️ แก้ไข</button>' +
          '<button class="btn small warn" data-uact="del" data-email="' + u.email + '">🗑 ลบ</button>' +
        '</div>' +
      '</div>').join('');
    window.__users = r.users;
  } catch (e) { alert(e.message); } finally { busy(false); }
}

$('userList').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-uact]');
  if (!btn) return;
  const email = btn.dataset.email;
  if (btn.dataset.uact === 'edit') openUserModal((window.__users || []).find(u => u.email === email));
  else delUser(email);
});

function openUserModal(u) {
  $('umTitle').textContent = u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้';
  $('umEmail').value = u ? u.email : '';
  $('umEmail').disabled = !!u;
  $('umName').value = u ? u.displayName : '';
  $('umPin').value = u ? u.pin : '';
  $('umRole').value = u ? u.role : 'RECORDER';
  $('umActive').checked = u ? u.active : true;
  $('umNote').value = u ? u.note : '';
  $('umMsg').textContent = '';
  $('userModal').classList.remove('hidden');
}
function closeUserModal() { $('userModal').classList.add('hidden'); }

$('umClose').onclick = closeUserModal;
$('btnNewUser').onclick = function () { openUserModal(null); };
$('btnReloadUsers').onclick = loadUsers;

$('umSave').onclick = async function () {
  const u = {
    email: $('umEmail').value.trim(),
    displayName: $('umName').value.trim(),
    pin: $('umPin').value.replace(/\D/g, ''),
    role: $('umRole').value,
    active: $('umActive').checked,
    allowedMeters: 'ALL',
    note: $('umNote').value.trim()
  };
  busy(true);
  try { await api('saveUser', { user: u }); closeUserModal(); await loadUsers(); }
  catch (e) { msg('umMsg', e.message, 'err'); }
  finally { busy(false); }
};

async function delUser(email) {
  if (!confirm('ลบผู้ใช้ ' + email + ' ออกจากระบบ?')) return;
  busy(true);
  try { await api('deleteUser', { targetEmail: email }); await loadUsers(); }
  catch (e) { alert(e.message); } finally { busy(false); }
}

/*** ══════════ PWA INSTALL ══════════ ***/
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredPrompt = e;
  $('btnInstall').classList.remove('hidden');
  $('btnInstallLogin').classList.remove('hidden');
});

async function doInstall() {
  if (!deferredPrompt) {
    alert('วิธีติดตั้งด้วยตนเอง\n\n' +
          '• iPhone / iPad — กดปุ่มแชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"\n' +
          '• Android — เมนู ⋮ แล้วเลือก "ติดตั้งแอป"\n' +
          '• คอมพิวเตอร์ — ไอคอนติดตั้งท้ายแถบที่อยู่เว็บ\n\n' +
          'หากติดตั้งไปแล้ว เมนูจะไม่แสดงอีก');
    return;
  }
  deferredPrompt.prompt();
  const res = await deferredPrompt.userChoice;
  if (res.outcome === 'accepted') {
    $('btnInstall').classList.add('hidden');
    $('btnInstallLogin').classList.add('hidden');
  }
  deferredPrompt = null;
}

$('btnInstall').onclick = doInstall;
$('btnInstallLogin').onclick = doInstall;

window.addEventListener('appinstalled', function () {
  $('btnInstall').classList.add('hidden');
  $('btnInstallLogin').classList.add('hidden');
  deferredPrompt = null;
});

/*** ══════════ TABS ══════════ ***/
document.querySelectorAll('.tab').forEach(function (t) {
  t.onclick = function () {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.tabpanel').forEach(p => p.classList.add('hidden'));
    $('tab-' + t.dataset.tab).classList.remove('hidden');
    if (t.dataset.tab === 'admin') loadUsers();
  };
});

/*** ══════════ INIT ══════════ ***/
(async function init() {
  if (!navigator.onLine) $('netbar').classList.remove('hidden');
  renderQueue();

  const s = LS.s;
  if (s) {
    S.user = s;
    busy(true);
    try { await start(); }
    catch (e) { localStorage.removeItem('wm_session'); S.user = null; }
    finally { busy(false); }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js')
        .then(r => console.log('SW ready:', r.scope))
        .catch(e => console.warn('SW failed:', e));
    });
  }
})();
