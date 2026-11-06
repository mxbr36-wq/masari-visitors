import * as api from './layout-api.js';
import { findConflict, findFreeSpot } from './geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const REASONS = { outside: 'خارج حدود القاعة', stage: 'فوق المنصة', pool: 'فوق المسبح', table: 'يتداخل مع طاولة أخرى' };
const STATUS = { saving: 'جارٍ الحفظ...', saved: 'تم الحفظ', error: 'فشل الحفظ', conflict: 'تعارض في التعديل' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

let root, st, ro;
const els = new Map();
const q = (sel) => root.querySelector(sel);
const byId = (id) => st.tables.find((t) => t.id === id);
const editable = () => st.layout.status === 'draft' && st.mode === 'edit';

export function mountLayout(container, openId = null) {
  root = container;
  root.onclick = onClick;
  root.onchange = onChange;
  root.onsubmit = onSubmit;
  return openId ? openLayout(openId) : showParties();
}
// يحاول حفظ المعلق أولاً؛ ولا يطلب التأكيد إلا إن تعذّر الحفظ.
export async function canLeaveLayout() {
  if (!st || !st.saver.pending()) return true;
  await st.saver.flush();
  const n = st.saver.pending();
  return n === 0 || confirm(`تعذّر حفظ ${n} تعديل. المغادرة ستُضيّعها. هل تريد المغادرة؟`);
}
export function leaveLayout() { ro?.disconnect(); st?.saver.stop(); st = null; }
window.addEventListener('beforeunload', (e) => {
  if (st && st.saver.pending()) { e.preventDefault(); e.returnValue = ''; }
});
// عودة الاتصال أو إخفاء الصفحة (التبديل لتطبيق آخر على الهاتف): حاول الحفظ فوراً.
window.addEventListener('online', () => { if (st?.saver.pending()) st.saver.flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && st?.saver.pending()) st.saver.flush(); });

/* ---------- الحفلات ---------- */
async function showParties() {
  root.innerHTML = '<p class="card">جارٍ التحميل...</p>';
  let parties;
  try { parties = await api.listParties(); } catch (err) { root.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  root.innerHTML = `<section class="card"><h3>حفلة جديدة</h3>
    <form id="party-form" class="inline-form">
      <input id="party-name" placeholder="اسم الحفلة" maxlength="80" required aria-label="اسم الحفلة">
      <input id="party-date" type="date" aria-label="تاريخ الحفلة">
      <button class="btn btn-primary" type="submit">إنشاء حفلة</button>
    </form><p id="party-error" class="form-error" hidden></p></section>
    <section class="card"><h3>الحفلات</h3>${parties.length ? parties.map(partyHtml).join('') : '<p class="muted">لا توجد حفلات بعد.</p>'}</section>`;
}

function partyHtml(p) {
  const layouts = [...p.party_layouts].sort((a, b) => b.revision - a.revision);
  const last = layouts[0];
  const open = layouts.map((l) => `<button class="btn btn-ghost" data-act="open" data-id="${l.id}">نسخة ${l.revision} · ${l.status === 'approved' ? 'معتمد' : 'مسودة'}</button>`).join('');
  const make = !last ? `<button class="btn btn-primary" data-act="new-layout" data-party="${p.id}">إنشاء مخطط</button>`
    : last.status === 'approved' ? `<button class="btn btn-primary" data-act="copy" data-id="${last.id}" data-party="${p.id}">إنشاء نسخة جديدة</button>` : '';
  return `<div class="party"><strong>${esc(p.name)}</strong><span class="muted">${p.event_date ? esc(p.event_date) : ''}</span>${open}${make}</div>`;
}

async function onSubmit(e) {
  e.preventDefault();
  const name = q('#party-name').value.trim();
  if (!name) return;
  try { await api.createParty(name, q('#party-date').value); await showParties(); } catch (err) { toast(err.message); }
}

const BUSY = ['open', 'new-layout', 'copy', 'new-revision', 'approve', 'add', 'delete'];
async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const { act, id, party } = b.dataset;
  if (BUSY.includes(act)) b.disabled = true; // يمنع النقر المزدوج
  try {
    if (act === 'open') await openLayout(id);
    else if (act === 'new-layout') await openLayout(await api.createLayout(party));
    else if (act === 'copy') await openLayout(await api.createLayout(party, id));
    else if (act === 'new-revision') await openLayout(await api.createLayout(st.layout.party_id, st.layout.id));
    else if (act === 'back') { if (await canLeaveLayout()) { leaveLayout(); await showParties(); } }
    else if (act === 'mode') { st.mode = b.dataset.mode; refreshMode(); }
    else if (act === 'add') await addTable();
    else if (act === 'delete') await removeTable();
    else if (act === 'zoom-in') zoomBy(1.3);
    else if (act === 'zoom-out') zoomBy(1 / 1.3);
    else if (act === 'fit') fit();
    else if (act === 'retry') st.saver.retry();
    else if (act === 'keep-mine') await resolveConflict(id, true);
    else if (act === 'take-theirs') await resolveConflict(id, false);
    else if (act === 'reload') await reloadLayout();
    else if (act === 'approve') await approve();
  } catch (err) { toast(err.message || 'حدث خطأ غير متوقع.'); }
  finally { if (BUSY.includes(act) && b.isConnected) b.disabled = false; }
}

/* ---------- المحرر ---------- */
const editorHtml = () => `<div class="layout-view">
  <div class="layout-bar">
    <button class="btn btn-ghost" data-act="back">رجوع</button>
    <div class="layout-title"><strong>${esc(st.layout.parties.name)}</strong><span class="chip" id="chip"></span></div>
    <span id="save-status" class="save-status" role="status"></span>
    <button id="retry" class="btn btn-ghost" data-act="retry" hidden>إعادة المحاولة</button>
  </div>
  <div class="layout-tools">
    <div class="seg" id="modes"><button data-act="mode" data-mode="edit">تحرير</button><button data-act="mode" data-mode="preview">معاينة</button></div>
    <button class="btn btn-ghost" id="add-btn" data-act="add">إضافة طاولة</button>
    <div class="seg"><button data-act="zoom-out" aria-label="تصغير">−</button><button data-act="fit">ملاءمة</button><button data-act="zoom-in" aria-label="تكبير">+</button></div>
  </div>
  <div id="conflicts" class="form-error" hidden></div>
  <p id="locked" class="form-error" hidden>اعتُمد هذا المخطط أو قُفل من جلسة أخرى، فلا يمكن حفظ تعديلاتك. <button class="btn btn-ghost" data-act="reload">إعادة تحميل المخطط</button></p>
  <div class="layout-body">
    <div class="canvas" id="canvas"><svg id="svg" role="img" aria-label="مخطط القاعة"><g id="world"></g></svg><div id="toast" class="toast" role="status" hidden></div></div>
    <aside id="side" class="side"></aside>
  </div></div>`;

async function openLayout(id) {
  if (!(await canLeaveLayout())) return;
  leaveLayout();
  root.innerHTML = '<p class="card">جارٍ التحميل...</p>';
  let data;
  try { data = await api.loadLayout(id); } catch (err) {
    root.innerHTML = `<p class="form-error">${esc(err.message)}</p><button class="btn btn-ghost" data-act="back">رجوع</button>`;
    return;
  }
  const { layout, tables } = data;
  st = { layout, hall: layout.hall_versions, tables, selected: null, conflicts: new Set(), mode: layout.status === 'draft' ? 'edit' : 'preview', view: { s: 1, x: 0, y: 0, min: 0.2, touched: false } };
  st.saver = api.createAutosaver({ onStatus: setStatus, onConflict: addConflict, onLocked: () => { q('#locked').hidden = false; } });
  root.innerHTML = editorHtml();
  bindCanvas();
  renderWorld();
  refreshMode();
  fit();
  ro = new ResizeObserver(() => { if (!st.view.touched) fit(); });
  ro.observe(q('#canvas'));
}

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.append(n);
  return n;
}

function renderWorld() {
  const world = q('#world');
  els.clear();
  world.replaceChildren();
  el('rect', { class: 'hall', x: 0, y: 0, width: st.hall.width, height: st.hall.height }, world);
  for (const f of st.hall.features) {
    const g = el('g', { class: `feature ${f.type}` }, world);
    el('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 3 }, g);
    el('text', { class: 'feature-label', x: f.x + f.w / 2, y: f.y + f.h / 2 }, g).textContent = f.label;
  }
  st.tables.forEach(drawTable);
}

function drawTable(t) {
  const { table_radius: r, chairs } = st.hall.table_spec;
  const g = el('g', { class: 'tbl', 'data-id': t.id }, q('#world'));
  for (let i = 0; i < chairs; i++) {
    const a = (2 * Math.PI * i) / chairs;
    el('circle', { class: 'chair', cx: (Math.cos(a) * (r + 3)).toFixed(2), cy: (Math.sin(a) * (r + 3)).toFixed(2), r: 2.4 }, g);
  }
  el('circle', { class: 'top', r }, g);
  el('text', { class: 'num', y: -0.8 }, g);
  el('text', { class: 'cap', y: 4.6 }, g);
  els.set(t.id, g);
  paintTable(t);
}

function paintTable(t) {
  const g = els.get(t.id);
  g.setAttribute('transform', `translate(${t.x} ${t.y})`);
  g.querySelector('.num').textContent = t.label;
  g.querySelector('.cap').textContent = t.capacity ?? '—';
  g.classList.toggle('nocap', t.capacity == null);
  g.classList.toggle('selected', t.id === st.selected);
}

function refreshMode() {
  const draft = st.layout.status === 'draft';
  if (!draft) st.mode = 'preview';
  q('#modes').hidden = !draft;
  q('#add-btn').hidden = !editable();
  q('#svg').classList.toggle('locked', !editable());
  q('#modes').querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === st.mode));
  const chip = q('#chip');
  chip.textContent = `نسخة ${st.layout.revision} · ${draft ? 'مسودة' : 'معتمد ومقفل'}`;
  chip.classList.toggle('is-approved', !draft);
  select(null);
}

function select(id) {
  st.selected = id;
  for (const [tid, g] of els) g.classList.toggle('selected', tid === id);
  renderSide();
}

function summaryHtml() {
  const withCap = st.tables.filter((t) => t.capacity != null);
  const missing = st.tables.filter((t) => t.capacity == null).map((t) => t.label);
  const total = withCap.reduce((sum, t) => sum + t.capacity, 0);
  return `<h3>ملخص المخطط</h3><dl class="summary"><dt>الحالة</dt><dd>${st.layout.status === 'approved' ? 'معتمد ومقفل' : 'مسودة'}</dd>
    <dt>عدد الطاولات</dt><dd>${st.tables.length}</dd><dt>طاولات محددة السعة</dt><dd>${withCap.length}</dd><dt>مجموع السعات</dt><dd>${total}</dd></dl>`
    + (missing.length ? `<p class="form-error">بلا سعة (${missing.length}): ${esc(missing.slice(0, 30).join('، '))}${missing.length > 30 ? '...' : ''}</p>` : '');
}

function renderSide() {
  const side = q('#side');
  const t = st.selected && byId(st.selected);
  if (st.layout.status === 'approved') {
    side.innerHTML = `${summaryHtml()}<p class="muted">هذا المخطط معتمد ومقفل. لتعديله أنشئ نسخة جديدة.</p><button class="btn btn-primary" data-act="new-revision">إنشاء نسخة جديدة</button>`;
  } else if (st.mode === 'preview') {
    const incomplete = st.tables.some((x) => x.capacity == null);
    side.innerHTML = `${summaryHtml()}<button class="btn btn-primary" data-act="approve" ${incomplete ? 'disabled' : ''}>اعتماد المخطط</button>${incomplete ? '<p class="muted">حدّد سعة كل الطاولات قبل الاعتماد.</p>' : ''}`;
  } else if (t) {
    side.innerHTML = `<div class="insp"><h3>طاولة ${esc(t.label)}</h3><button class="btn btn-ghost" data-act="delete">حذف الطاولة</button>
      <label for="f-label">رقم الطاولة</label><label for="f-cap">السعة</label>
      <input id="f-label" value="${esc(t.label)}" maxlength="10"><input id="f-cap" type="number" min="1" max="99" inputmode="numeric" value="${t.capacity ?? ''}">
      <p id="f-err" class="form-error" hidden></p></div>`;
  } else {
    side.innerHTML = '<p class="muted">اختر طاولة لتعديل رقمها وسعتها، أو اسحبها لتحريكها. اسحب الخلفية للتحريك، وبإصبعين أو عجلة الماوس للتكبير.</p>';
  }
}

function onChange(e) {
  const t = st && st.selected && byId(st.selected);
  if (!t || !editable() || !['f-label', 'f-cap'].includes(e.target.id)) return;
  const err = q('#f-err');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; e.target.value = e.target.id === 'f-label' ? t.label : (t.capacity ?? ''); };
  err.hidden = true;
  if (e.target.id === 'f-label') {
    const label = e.target.value.trim();
    if (!label || label.length > 10) return fail('رقم الطاولة من 1 إلى 10 أحرف.');
    if (st.tables.some((x) => x !== t && x.label === label)) return fail('رقم الطاولة مستخدم.');
    t.label = label;
  } else {
    const v = e.target.value.trim();
    const n = v === '' ? null : Number(v);
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 99)) return fail('السعة عدد صحيح من 1 إلى 99.');
    t.capacity = n;
  }
  paintTable(t);
  q('#side h3').textContent = `طاولة ${t.label}`;
  st.saver.touch(t);
}

/* ---------- الحالة والرسائل ---------- */
function setStatus(kind, msg, retryable) {
  const s = q('#save-status');
  if (!s) return;
  s.textContent = kind === 'error' ? `${STATUS.error}: ${msg}${retryable ? ' (تُعاد المحاولة تلقائياً)' : ''}` : STATUS[kind];
  s.dataset.state = kind;
  q('#retry').hidden = kind !== 'error';
}

let toastTimer;
function toast(msg) {
  const t = q('#toast') || q('#party-error');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function persist(fn) {
  setStatus('saving');
  try { const r = await fn(); setStatus('saved'); return r; } catch (e) { setStatus('error', e.message); throw e; }
}

/* ---------- إضافة وحذف واعتماد ---------- */
async function addTable() {
  const { width, height } = q('#canvas').getBoundingClientRect();
  const v = st.view;
  const c = { x: (width / 2 - v.x) / v.s, y: (height / 2 - v.y) / v.s };
  const spot = findFreeSpot(c, st.hall, st.tables);
  if (!spot) return toast('لا يوجد مكان شاغر لطاولة جديدة.');
  let i = 1;
  while (st.tables.some((t) => t.label === `N${i}`)) i++;
  const row = await persist(() => api.insertTable(st.layout.id, { label: `N${i}`, x: round1(spot.x), y: round1(spot.y) }));
  st.tables.push(row);
  drawTable(row);
  select(row.id);
}

async function removeTable() {
  const t = byId(st.selected);
  if (!t || !confirm(`حذف الطاولة ${t.label}؟`)) return;
  st.saver.drop(t.id);
  await persist(() => api.deleteTable(t.id));
  removeLocal(t);
}

function removeLocal(t) {
  st.tables = st.tables.filter((x) => x !== t);
  els.get(t.id)?.remove();
  els.delete(t.id);
  if (st.selected === t.id) select(null);
}

/* ---------- تعارض الجلسات ---------- */
function renderConflicts() {
  const box = q('#conflicts');
  box.hidden = !st.conflicts.size;
  box.innerHTML = [...st.conflicts].map((id) => `<div class="conflict-row"><span>الطاولة ${esc(byId(id)?.label ?? '')} عُدِّلت من جلسة أخرى.</span>
    <button class="btn btn-ghost" data-act="keep-mine" data-id="${id}">الاحتفاظ بتعديلي</button>
    <button class="btn btn-ghost" data-act="take-theirs" data-id="${id}">اعتماد نسخة الخادم</button></div>`).join('');
}
function addConflict(t) { st.conflicts.add(t.id); renderConflicts(); }

async function resolveConflict(id, keepMine) {
  const t = byId(id);
  const server = await api.fetchTable(id);
  st.conflicts.delete(id);
  if (!server) { // حُذفت من جلسة أخرى
    st.saver.drop(id);
    removeLocal(t);
    toast('حُذفت هذه الطاولة من جلسة أخرى وأُزيلت من العرض.');
  } else if (keepMine) {
    t.updated_at = server.updated_at;
    st.saver.resolve(id);
    st.saver.touch(t);
  } else {
    Object.assign(t, server);
    st.saver.drop(id);
    paintTable(t);
    if (st.selected === id) renderSide();
  }
  renderConflicts();
}

async function reloadLayout() {
  if (st.saver.pending() && !confirm('ستُتجاهل تعديلاتك غير المحفوظة. هل تريد المتابعة؟')) return;
  const id = st.layout.id;
  st.saver.stop();
  await openLayout(id);
}

async function approve() {
  if (!confirm('بعد الاعتماد يُقفل المخطط ولا يُعدَّل إلا بإنشاء نسخة جديدة. هل تريد المتابعة؟')) return;
  await st.saver.flush();
  if (st.saver.pending()) return toast('لم يكتمل حفظ التعديلات. حاول مرة أخرى.');
  await api.approveLayout(st.layout.id);
  await openLayout(st.layout.id);
}

/* ---------- العرض: تكبير وتحريك وسحب ---------- */
const applyView = () => q('#world').setAttribute('transform', `translate(${st.view.x} ${st.view.y}) scale(${st.view.s})`);

function fit() {
  const { width: w, height: h } = q('#canvas').getBoundingClientRect();
  const s = Math.min(w / st.hall.width, h / st.hall.height) * 0.97;
  st.view = { s, x: (w - st.hall.width * s) / 2, y: (h - st.hall.height * s) / 2, min: s * 0.5, touched: false };
  applyView();
}

function zoomAt(px, py, factor) {
  const v = st.view;
  const s = clamp(v.s * factor, v.min, 12);
  v.x = px - ((px - v.x) * s) / v.s;
  v.y = py - ((py - v.y) * s) / v.s;
  v.s = s;
  v.touched = true;
  applyView();
}
function zoomBy(factor) {
  const { width, height } = q('#canvas').getBoundingClientRect();
  zoomAt(width / 2, height / 2, factor);
}

function bindCanvas() {
  const svg = q('#svg');
  const pointers = new Map();
  let drag = null, pan = null, pinch = null;
  const rect = () => svg.getBoundingClientRect();
  const pair = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; };
  // خط الأساس للتكبير: يُعاد حسابه كلما تغيّر عدد الأصابع كي لا يحدث قفز في العرض.
  const startPinch = () => ({ ...pair(), s: st.view.s, vx: st.view.x, vy: st.view.y });
  // إصبع ثانٍ أثناء سحب طاولة يعني تكبيراً لا نقلاً: تُلغى الحركة وتعود الطاولة لموضعها.
  const cancelDrag = () => {
    if (!drag) return;
    const { t, ox, oy } = drag;
    drag = null;
    t.x = ox; t.y = oy;
    paintTable(t);
    els.get(t.id).classList.remove('invalid');
  };

  svg.addEventListener('pointerdown', (e) => {
    try { svg.setPointerCapture(e.pointerId); } catch { /* مؤشر غير نشط */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      cancelDrag();
      pan = null;
      pinch = startPinch();
      return;
    }
    const g = e.target.closest('.tbl');
    if (g && editable()) {
      const t = byId(g.dataset.id);
      select(t.id);
      drag = { t, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, last: { x: t.x, y: t.y }, conflict: null, moved: false };
    } else {
      if (!g && editable()) select(null);
      pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y };
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = st.view;
    if (pinch && pointers.size >= 2) {
      const { d, cx, cy } = pair();
      const r = rect();
      const s = clamp((pinch.s * d) / pinch.d, v.min, 12);
      v.x = cx - r.left - ((pinch.cx - r.left - pinch.vx) * s) / pinch.s;
      v.y = cy - r.top - ((pinch.cy - r.top - pinch.vy) * s) / pinch.s;
      v.s = s; v.touched = true;
      applyView();
    } else if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      const t = drag.t;
      t.x = round1(drag.ox + dx / v.s);
      t.y = round1(drag.oy + dy / v.s);
      drag.conflict = findConflict(t, st.hall, st.tables, t.id);
      if (!drag.conflict) drag.last = { x: t.x, y: t.y };
      paintTable(t);
      els.get(t.id).classList.toggle('invalid', !!drag.conflict);
    } else if (pan && e.pointerId === pan.id) {
      v.x = pan.vx + e.clientX - pan.sx; v.y = pan.vy + e.clientY - pan.sy; v.touched = true;
      applyView();
    }
  });

  // انتقالات الحالة: إصبع واحد = سحب طاولة أو تحريك العرض، إصبعان = تكبير.
  // بعد رفع أحد إصبعي التكبير يتحول الباقي إلى تحريك للعرض فقط، ولا يعود سحباً للطاولة.
  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (drag && drag.id === e.pointerId) {
      const { t, last, conflict, moved, ox, oy } = drag;
      drag = null;
      if (moved) {
        els.get(t.id).classList.remove('invalid');
        t.x = last.x; t.y = last.y;
        paintTable(t);
        if (conflict) toast(`موضع غير صالح (${REASONS[conflict.reason]}). أُعيدت الطاولة إلى آخر موضع صالح.`);
        if (t.x !== ox || t.y !== oy) st.saver.touch(t);
      }
    }
    if (pan && pan.id === e.pointerId) pan = null;
    if (pointers.size >= 2) pinch = startPinch();
    else {
      pinch = null;
      if (pointers.size === 1 && !drag) {
        const [id, pt] = [...pointers][0];
        pan = { id, sx: pt.x, sy: pt.y, vx: st.view.x, vy: st.view.y };
      }
    }
  };
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', (e) => { if (drag && drag.id === e.pointerId) cancelDrag(); end(e); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = rect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
}
