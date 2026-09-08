/*** ══════════ ตั้งค่า (แก้ 2 บรรทัดนี้) ══════════ ***/
const CONFIG = {
  API_URL: 'PASTE_YOUR_EXEC_URL_HERE',
  API_KEY: 'CHANGE_ME_TO_RANDOM_STRING_123456'
};

/*** ══════════ STATE ══════════ ***/
const S = {
  user: null,
  day: null,
  meters: [],
  bizDate: '',
  viewDate: '',
  unlocked: {},
  editing: {}
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
const labelOf = s => s === 'ALERT' ? 'สูงกว่าปกติ' : s === 'REVIEW' ? 'ต้องตรวจสอบ' : s === 'INITIAL' ? 'ตั้งต้น' : 'ปกติ';
const nameOf = id => { const m = S.meters.find(x => x.meterId === id); return m ? m.meterName : id; };

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
  } catch (e) {
    msg('loginMsg', e.message, 'err');
  } finally { busy(false); }
};

$('loginPin').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });

$('btnLogout').onclick = function () {
  localStorage.removeItem('wm_session');
  location.reload();
};

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
async function loadDay() {
  busy(true);
  try {
    S.day = await api('getDay', { date: S.viewDate });
    S.editing = {};
    renderMeters();
    renderStats(S.day.stats);
  } catch (e) {
    msg('entryMsg', e.message, 'err');
  } finally { busy(false); }
}

function renderStats(st) {
  $('stDone').textContent = st.submitted;
  $('stPending').textContent = st.pending;
  $('stAlert').textContent = st.alert;
  $('stUsage').textContent = st.totalUsage;
}

$('btnLoadEntryDate').onclick = async function () {
  S.viewDate = $('entryDate').value || S.bizDate;
  S.unlocked = {};
  await loadDay();
};
$('btnTodayEntry').onclick = async function () {
  S.viewDate = S.bizDate;
  $('entryDate').value = S.bizDate;
  S.unlocked = {};
  await loadDay();
};

/*** ══════════ RENDER METERS ══════════ ***/
function renderMeters() {
  const back = S.viewDate !== S.bizDate;
  $('meterList').innerHTML =
    (back ? '<div class="backdate">📅 กำลังดูวันที่ ' + S.viewDate + ' (ไม่ใช่วันปัจจุบัน)</div>' : '') +
    S.day.items.map(function (it) {
      const id = it.meterId;

      /* ── โหมดแก้ไข ── */
      if (it.submitted && S.editing[id]) {
        const prefix = String(Math.floor(it.fullReading / Math.pow(10, it.inputDigits)));
        return '<div class="card editmode">' +
          '<div class="card-head"><b>' + it.meterName + '</b><span class="pill edit">✏️ โหมดแก้ไข</span></div>' +
          '<div class="card-body">' +
            '<div class="hint">แก้เฉพาะ ' + it.inputDigits + ' หลักท้าย · หลักหน้า <b>' + prefix + '</b> คงเดิม ไม่รันเพิ่ม</div>' +
            '<div class="input-row">' +
              '<span class="prefix">' + prefix + '</span>' +
              '<input class="eval" data-id="' + id + '" type="tel" inputmode="numeric" maxlength="' + it.inputDigits + '" value="' + it.inputValue + '">' +
            '</div>' +
            '<div class="preview" id="epv-' + id + '"></div>' +
            '<div class="row">' +
              '<button class="btn primary" data-act="saveEdit" data-id="' + id + '">บันทึกการแก้ไข</button>' +
              '<button class="btn" data-act="cancelEdit" data-id="' + id + '">ยกเลิก</button>' +
            '</div>' +
          '</div></div>';
      }

      /* ── บันทึกแล้ว ── */
      if (it.submitted && !S.unlocked[id]) {
        return '<div class="card done">' +
          '<div class="card-head"><b>' + it.meterName + '</b>' +
          '<span class="pill ' + pillOf(it.status) + '">' + labelOf(it.status) + '</span></div>' +
          '<div class="card-body">' +
            '<div class="kv"><span>เลขเต็ม</span><b>' + fmt(it.fullReading, it.digitLength) + '</b></div>' +
            '<div class="kv"><span>ใช้ไป</span><b>' + it.usageUnits + ' หน่วย</b></div>' +
            '<div class="kv muted"><span>โดย</span><span>' + it.submittedBy + '</span></div>' +
            (it.entryCount > 1 ? '<div class="kv muted"><span>บันทึกวันนี้</span><span>' + it.entryCount + ' ครั้ง</span></div>' : '') +
            (isAdmin() ?
              '<div class="row admin-actions">' +
                '<button class="btn small" data-act="edit" data-id="' + id + '">✏️ แก้ไขเลข</button>' +
                '<button class="btn small warn" data-act="unlock" data-id="' + id + '">🔓 ปลดล็อก</button>' +
              '</div>' : '') +
          '</div></div>';
      }

      /* ── ปลดล็อก / ยังไม่บันทึก ── */
      const isInit = !it.hasBaseline;
      const un = !!S.unlocked[id];
      return '<div class="card' + (un ? ' unlocked' : '') + '">' +
        '<div class="card-head"><b>' + it.meterName + '</b>' +
        '<span class="pill ' + (un ? 'unlock' : isInit ? 'init' : 'gray') + '">' +
          (un ? '🔓 รอบเพิ่ม' : isInit ? 'ตั้งค่าเริ่มต้น' : 'ครั้งก่อน ' + fmt(it.previousReading, it.digitLength)) +
        '</span></div>' +
        '<div class="card-body">' +
          (un ? '<div class="hint">ฐานคำนวณ <b>' + fmt(it.fullReading, it.digitLength) + '</b> · หลักหน้าจะรันเพิ่มตามปกติ</div>' : '') +
          '<div class="input-row">' +
            '<input class="mval" data-id="' + id + '" type="tel" inputmode="numeric" maxlength="' +
              (isInit ? it.digitLength : it.inputDigits) + '" placeholder="' +
              (isInit ? 'เลขเต็ม ' + it.digitLength + ' หลัก' : it.inputDigits + ' หลักท้าย') + '">' +
            '<label class="fullchk"><input type="checkbox" class="mfull" data-id="' + id + '"' +
              (isInit ? ' checked disabled' : '') + '> เลขเต็ม</label>' +
          '</div>' +
          '<div class="preview" id="pv-' + id + '"></div>' +
          (un ? '<button class="btn small" data-act="cancelUnlock" data-id="' + id + '">ยกเลิกการปลดล็อก</button>' : '') +
        '</div></div>';
    }).join('');

  document.querySelectorAll('.mval').forEach(el => el.addEventListener('input', onInput));
  document.querySelectorAll('.eval').forEach(el => {
    el.addEventListener('input', onEditInput);
    onEditInput({ target: el });
  });
  document.querySelectorAll('.mfull').forEach(el => el.addEventListener('change', function (e) {
    const id = e.target.dataset.id;
    const it = S.day.items.find(x => x.meterId === id);
    const inp = document.querySelector('.mval[data-id="' + id + '"]');
    inp.maxLength = e.target.checked ? it.digitLength : it.inputDigits;
    inp.placeholder = e.target.checked ? 'เลขเต็ม ' + it.digitLength + ' หลัก' : it.inputDigits + ' หลักท้าย';
    inp.value = '';
    onInput({ target: inp });
  }));
}

/* ปุ่มทั้งหมดในการ์ด */
$('meterList').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.act) {
    case 'edit':         S.editing[id] = true; renderMeters(); break;
    case 'cancelEdit':   delete S.editing[id]; renderMeters(); break;
    case 'unlock':       unlockMeter(id); break;
    case 'cancelUnlock': delete S.unlocked[id]; renderMeters(); break;
    case 'saveEdit':     saveEdit(id); break;
  }
});

function unlockMeter(id) {
  if (!confirm('ปลดล็อกเพื่อบันทึกรอบใหม่?\n\nหลักหน้าจะรันเพิ่มตามปกติ\nเช่น 144 กรอก 40 → 240')) return;
  S.unlocked[id] = true;
  renderMeters();
}

/*** ══════════ PREVIEW ══════════ ***/
function onInput(e) {
  const id = e.target.dataset.id;
  const it = S.day.items.find(x => x.meterId === id);
  const pv = $('pv-' + id);
  const raw = e.target.value.replace(/\D/g, '');
  e.target.value = raw;
  if (!raw) { pv.innerHTML = ''; pv.className = 'preview'; return; }

  const isFull = document.querySelector('.mfull[data-id="' + id + '"]').checked;
  const base = S.unlocked[id] ? it.fullReading : it.previousReading;
  let full, usage;
  if (isFull) {
    full = Number(raw);
    usage = it.hasBaseline ? calcUsage(base, full, it.digitLength) : 0;
  } else {
    full = computeFull(base, Number(raw), it.inputDigits, it.digitLength);
    usage = calcUsage(base, full, it.digitLength);
  }

  const over = it.hardLimit && usage > it.hardLimit;
  const warn = !over && it.normalLimit && usage > it.normalLimit;
  pv.className = 'preview ' + (over ? 'critical' : warn ? 'warn' : 'ok');
  pv.innerHTML = '<b>' + fmt(full, it.digitLength) + '</b> · ใช้ <b>' + usage + '</b> หน่วย ' +
    (over ? '⛔ สูงผิดปกติมาก ต้องยืนยัน' : warn ? '🔴 สูงกว่าเกณฑ์ ' + it.normalLimit : '🟢 ปกติ');
}

function onEditInput(e) {
  const id = e.target.dataset.id;
  const it = S.day.items.find(x => x.meterId === id);
  const pv = $('epv-' + id);
  const raw = e.target.value.replace(/\D/g, '');
  e.target.value = raw;
  if (!raw) { pv.innerHTML = ''; pv.className = 'preview'; return; }

  const b = Math.pow(10, it.inputDigits);
  const newFull = Math.floor(it.fullReading / b) * b + Number(raw);
  const usage = newFull - it.previousReading;
  const bad = usage < 0;
  const over = !bad && it.normalLimit && usage > it.normalLimit;
  pv.className = 'preview ' + (bad ? 'critical' : over ? 'warn' : 'ok');
  pv.innerHTML = 'เดิม ' + fmt(it.fullReading, it.digitLength) + ' → ใหม่ <b>' +
    fmt(newFull, it.digitLength) + '</b> · ใช้ <b>' + usage + '</b> หน่วย ' +
    (bad ? '⛔ ติดลบ ตรวจสอบอีกครั้ง' : over ? '🔴 สูงกว่าเกณฑ์' : '🟢 ปกติ');
}

/*** ══════════ SUBMIT ══════════ ***/
$('btnSubmit').onclick = async function () {
  const entries = [];
  document.querySelectorAll('.mval').forEach(function (inp) {
    const v = inp.value.replace(/\D/g, '');
    if (!v) return;
    const id = inp.dataset.id;
    entries.push({
      readingId: uuid(),
      meterId: id,
      value: v,
      mode: document.querySelector('.mfull[data-id="' + id + '"]').checked ? 'FULL' : 'SUFFIX',
      force: !!S.unlocked[id],
      source: navigator.onLine ? 'ONLINE' : 'OFFLINE_SYNC'
    });
  });
  if (!entries.length) return msg('entryMsg', 'ยังไม่ได้กรอกข้อมูล', 'err');

  if (!navigator.onLine) {
    const q = LS.q;
    q.push({ date: S.viewDate, entries: entries });
    LS.q = q;
    renderQueue();
    return msg('entryMsg', 'บันทึกในเครื่องแล้ว รอส่งเมื่อกลับมาออนไลน์', 'warn');
  }
  await send(S.viewDate, entries, false);
};

async function send(date, entries, confirmed) {
  busy(true);
  try {
    const r = await api('submitReadings', {
      date: date,
      entries: entries.map(e => Object.assign({}, e, { confirmed: !!confirmed }))
    });

    const needConfirm = r.results.filter(x => x.needConfirm);
    const failed = r.results.filter(x => !x.ok && !x.needConfirm);
    r.results.filter(x => x.ok).forEach(x => { delete S.unlocked[x.meterId]; });

    if (needConfirm.length) {
      const txt = needConfirm.map(x => '• ' + nameOf(x.meterId) + ': ' + x.previewUsage + ' หน่วย').join('\n');
      if (confirm('พบค่าสูงกว่าเกณฑ์:\n' + txt + '\n\nยืนยันบันทึกหรือไม่?')) {
        const retry = entries.filter(e => needConfirm.some(n => n.meterId === e.meterId));
        busy(false);
        return await send(date, retry, true);
      }
    }

    if (failed.length) {
      msg('entryMsg', 'ไม่สำเร็จ: ' + failed.map(f => nameOf(f.meterId) + ' — ' + f.error).join(' | '), 'err');
    } else if (r.saved) {
      msg('entryMsg', 'บันทึกสำเร็จ ' + r.saved + ' จุด', 'ok');
    }
    await loadDay();
  } catch (e) {
    msg('entryMsg', e.message, 'err');
  } finally { busy(false); }
}

async function saveEdit(id) {
  const it = S.day.items.find(x => x.meterId === id);
  const el = document.querySelector('.eval[data-id="' + id + '"]');
  const val = el.value.replace(/\D/g, '');
  if (!val) return alert('กรุณากรอกตัวเลข');
  busy(true);
  try {
    const r = await api('editReading', { readingId: it.readingId, value: val, mode: 'SUFFIX' });
    delete S.editing[id];
    msg('entryMsg', 'แก้ไขสำเร็จ: ' + r.oldFull + ' → ' + r.fullReading + ' (' + r.usageUnits + ' หน่วย)', 'ok');
    await loadDay();
  } catch (e) {
    alert(e.message);
  } finally { busy(false); }
}

/*** ══════════ OFFLINE QUEUE ══════════ ***/
function renderQueue() {
  const q = LS.q, bar = $('queueBar');
  bar.classList.toggle('hidden', !q.length);
  if (q.length) bar.textContent = 'มี ' + q.length + ' ชุดข้อมูลรอส่ง';
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

window.addEventListener('online', function () {
  $('netbar').classList.add('hidden');
  flushQueue();
});
window.addEventListener('offline', function () {
  $('netbar').classList.remove('hidden');
});

/*** ══════════ SUMMARY & HISTORY ══════════ ***/
$('btnLoadSum').onclick = async function () {
  busy(true);
  try {
    const d = await api('getDay', { date: $('sumDate').value });
    $('summaryBox').innerHTML =
      '<div class="sumhead">รวม ' + d.stats.totalUsage + ' หน่วย · บันทึก ' +
      d.stats.submitted + '/' + d.stats.total + ' · เตือน ' + d.stats.alert + '</div>' +
      d.items.map(i =>
        '<div class="srow' + (i.submitted ? '' : ' pending') + '">' +
          '<div class="sname">' + i.meterName + '</div>' +
          '<div class="snum">' + i.previousReading + ' → ' + (i.fullReading === null ? '—' : i.fullReading) + '</div>' +
          '<div class="suse ' + pillOf(i.status) + '">' + (i.usageUnits === null ? '—' : i.usageUnits) + '</div>' +
        '</div>').join('');
  } catch (e) { alert(e.message); } finally { busy(false); }
};

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
let umEditing = null;

async function loadUsers() {
  busy(true);
  try {
    const r = await api('listUsers');
    $('userList').innerHTML = r.users.map(u =>
      '<div class="card' + (u.active ? '' : ' done') + '">' +
        '<div class="card-head"><b>' + (u.displayName || u.email) + '</b>' +
        '<span class="pill ' + (u.role === 'ADMIN' ? 'red' : u.role === 'RECORDER' ? 'green' : 'gray') + '">' + u.role + '</span></div>' +
        '<div class="card-body">' +
          '<div class="kv muted"><span>' + u.email + '</span><span>' + (u.active ? '🟢 ใช้งาน' : '⚪ ปิด') + '</span></div>' +
          '<div class="row admin-actions">' +
            '<button class="btn small" data-uact="edit" data-email="' + u.email + '">✏️ แก้ไข</button>' +
            '<button class="btn small warn" data-uact="del" data-email="' + u.email + '">🗑 ลบ</button>' +
          '</div>' +
        '</div></div>').join('');
    window.__users = r.users;
  } catch (e) { alert(e.message); } finally { busy(false); }
}

$('userList').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-uact]');
  if (!btn) return;
  const email = btn.dataset.email;
  if (btn.dataset.uact === 'edit') {
    openUserModal((window.__users || []).find(u => u.email === email));
  } else {
    delUser(email);
  }
});

function openUserModal(u) {
  umEditing = u ? u.email : null;
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
  try {
    await api('saveUser', { user: u });
    closeUserModal();
    await loadUsers();
  } catch (e) {
    msg('umMsg', e.message, 'err');
  } finally { busy(false); }
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
