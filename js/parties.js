import * as api from './parties-api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// توحيد النص العربي للبحث والمقارنة: بلا تشكيل، وتوحيد الألف والياء والتاء المربوطة والأرقام.
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).toLowerCase().trim();
const key = (s) => norm(s).replace(/[\s_-]/g, '');
const byName = (a, b) => a.name.localeCompare(b.name, 'ar');
const MAX_CSV = 1000;
const HEADERS = Object.fromEntries(Object.entries({
  name: ['name', 'family', 'family name', 'اسم العائلة', 'الاسم', 'اسم', 'العائلة', 'عائلة'],
  members_count: ['members', 'members count', 'count', 'عدد الأفراد', 'عدد الافراد', 'العدد', 'عدد', 'الأفراد'],
  contact_name: ['contact', 'contact name', 'المسؤول', 'اسم المسؤول', 'جهة التواصل'],
  phone: ['phone', 'mobile', 'tel', 'الهاتف', 'هاتف', 'الجوال', 'جوال', 'رقم الهاتف'],
  notes: ['notes', 'note', 'ملاحظات', 'ملاحظة'],
  guests: ['guests', 'الضيوف', 'ضيوف', 'أسماء الضيوف'],
}).map(([field, list]) => [field, list.map(key)]));

let root, opts, parties = [], editing = null, st = null;
const q = (sel) => root.querySelector(sel);

export function mountParties(container, options) {
  root = container;
  opts = options;
  root.onclick = onClick;
  root.onsubmit = onSubmit;
  root.oninput = onInput;
  root.onchange = onChange;
  root.addEventListener('toggle', onToggle, true);
  return showParties();
}
export function leaveParties() {
  if (!root) return;
  root.onclick = root.onsubmit = root.oninput = root.onchange = null;
  root.removeEventListener('toggle', onToggle, true);
  st = null;
  editing = null;
}

let msgTimer;
function msg(text, ok = false) {
  const m = q('#msg');
  if (!m) return;
  m.textContent = text;
  m.hidden = !text;
  m.classList.toggle('is-ok', ok);
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { m.hidden = true; }, 6000);
}

/* ---------- قائمة الحفلات ---------- */
async function showParties() {
  st = null;
  root.innerHTML = '<p class="card">جارٍ التحميل...</p>';
  try { parties = await api.listParties(); } catch (err) { root.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  root.innerHTML = `<section class="card"><h3>حفلة جديدة</h3>
    <form class="inline-form" data-form="party-new">
      <input name="name" placeholder="اسم الحفلة" maxlength="80" required aria-label="اسم الحفلة">
      <input name="event_date" type="date" aria-label="تاريخ الحفلة">
      <button class="btn btn-primary" type="submit">إنشاء حفلة</button>
    </form><p id="msg" class="form-error" hidden></p></section>
    <section class="card"><h3>الحفلات</h3><div id="plist"></div></section>`;
  renderParties();
}

function layoutButtons(p) {
  const layouts = [...p.party_layouts].sort((a, b) => a.revision - b.revision);
  return layouts.length
    ? layouts.map((l) => `<button class="btn btn-ghost" data-act="open-layout" data-id="${l.id}">مخطط نسخة ${l.revision} · ${l.status === 'approved' ? 'معتمد' : 'مسودة'}</button>`).join('')
    : `<button class="btn btn-ghost" data-act="make-layout" data-id="${p.id}">إنشاء مخطط</button>`;
}

function partyRow(p) {
  if (editing === p.id) {
    return `<form class="party" data-form="party-edit" data-id="${p.id}">
      <input name="name" value="${esc(p.name)}" maxlength="80" required aria-label="اسم الحفلة">
      <input name="event_date" type="date" value="${esc(p.event_date || '')}" aria-label="تاريخ الحفلة">
      <button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" data-act="cancel-party">إلغاء</button></form>`;
  }
  return `<div class="party"><strong>${esc(p.name)}</strong><span class="muted">${esc(p.event_date || '')}</span>
    <button class="btn btn-primary" data-act="open-party" data-id="${p.id}">العائلات والضيوف</button>
    <button class="btn btn-ghost" data-act="open-seating" data-id="${p.id}">توزيع العائلات</button>${layoutButtons(p)}
    <button class="btn btn-ghost" data-act="edit-party" data-id="${p.id}">تعديل</button>
    ${p.party_layouts.length ? '' : `<button class="btn btn-ghost" data-act="delete-party" data-id="${p.id}">حذف</button>`}</div>`;
}
const renderParties = () => { q('#plist').innerHTML = parties.length ? parties.map(partyRow).join('') : '<p class="muted">لا توجد حفلات بعد.</p>'; };

/* ---------- حفلة: العائلات والضيوف ---------- */
async function showParty(id) {
  root.innerHTML = '<p class="card">جارٍ التحميل...</p>';
  try {
    const families = await api.listFamilies(id);
    st = { party: parties.find((p) => p.id === id), families: families.sort(byName), open: new Set(), query: '', editFamily: null, editGuest: null, preview: null };
  } catch (err) {
    root.innerHTML = `<p class="form-error">${esc(err.message)}</p><button class="btn btn-ghost" data-act="back">رجوع</button>`;
    return;
  }
  root.innerHTML = `<div class="parties-view">
    <div class="layout-bar"><button class="btn btn-ghost" data-act="back">رجوع</button>
      <div class="layout-title"><strong>${esc(st.party.name)}</strong><span class="chip" id="stats"></span></div></div>
    <div class="layout-tools"><button class="btn btn-primary" data-act="open-seating" data-id="${st.party.id}">توزيع العائلات</button>${layoutButtons(st.party)}
      <button class="btn btn-primary" data-act="toggle-add">إضافة عائلة</button>
      <label class="btn btn-ghost file-btn">استيراد CSV<input id="csv-file" type="file" accept=".csv,text/csv,text/plain" hidden></label></div>
    <p id="msg" class="form-error" hidden></p>
    <section class="card" id="add-wrap" hidden>${familyForm('family-add', {})}</section>
    <section class="card" id="import-wrap" hidden></section>
    <input id="search" type="search" class="search" placeholder="ابحث في عائلات وضيوف هذه الحفلة" aria-label="بحث داخل الحفلة">
    <div id="flist"></div></div>`;
  renderList();
  renderStats();
}

const familyForm = (kind, f, id = '') => `<form class="fam-form" data-form="${kind}" data-id="${id}">
  <label>اسم العائلة<input name="name" value="${esc(f.name)}" maxlength="120" required></label>
  <label>عدد الأفراد<input name="members_count" type="number" min="1" max="99" inputmode="numeric" value="${esc(f.members_count)}" required></label>
  <label>اسم المسؤول<input name="contact_name" value="${esc(f.contact_name)}" maxlength="120"></label>
  <label>الهاتف<input name="phone" value="${esc(f.phone)}" maxlength="30" inputmode="tel" dir="ltr"></label>
  <label class="wide">ملاحظات<input name="notes" value="${esc(f.notes)}" maxlength="500"></label>
  <div class="wide"><button class="btn btn-primary" type="submit">حفظ</button> <button class="btn btn-ghost" type="button" data-act="cancel-edit">إلغاء</button></div></form>`;

function familyHtml(f, tokens) {
  if (st.editFamily === f.id) return `<div class="family editing">${familyForm('family-edit', f, f.id)}</div>`;
  const hit = (g) => tokens.some((t) => norm(g.full_name).includes(t));
  const forced = !st.open.has(f.id) && tokens.length > 0 && f.guests.some(hit);
  const guests = f.guests.map((g) => (st.editGuest === g.id
    ? `<li><form class="inline-form" data-form="guest-edit" data-id="${g.id}"><input name="full_name" value="${esc(g.full_name)}" maxlength="120" required aria-label="اسم الضيف">
        <button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" data-act="cancel-edit">إلغاء</button></form></li>`
    : `<li class="${hit(g) ? 'hit' : ''}"><span>${esc(g.full_name)}</span><span class="row-actions">
        <button class="btn btn-ghost" data-act="edit-guest" data-id="${g.id}">تعديل</button>
        <button class="btn btn-ghost" data-act="delete-guest" data-id="${g.id}">حذف</button></span></li>`)).join('');
  const info = [f.contact_name && `المسؤول: ${esc(f.contact_name)}`, f.phone && `الهاتف: <bdi dir="ltr">${esc(f.phone)}</bdi>`, f.notes && `ملاحظات: ${esc(f.notes)}`].filter(Boolean);
  return `<details class="family" data-id="${f.id}" ${st.open.has(f.id) || forced ? 'open' : ''} ${forced ? 'data-auto="1"' : ''}>
    <summary><strong>${esc(f.name)}</strong><span class="muted">${f.members_count} أفراد · ${f.guests.length} أسماء</span></summary>
    <div class="fam-body">${info.length ? `<p class="muted">${info.join(' · ')}</p>` : ''}
      <ul class="guests">${guests}</ul>
      ${f.guests.length < f.members_count
    ? `<form class="inline-form" data-form="guest-add" data-id="${f.id}"><input name="full_name" placeholder="اسم الضيف" maxlength="120" required aria-label="اسم ضيف جديد"><button class="btn btn-ghost" type="submit">إضافة ضيف</button></form>`
    : '<p class="muted">اكتمل عدد الأسماء لهذه العائلة.</p>'}
      <div class="row-actions"><button class="btn btn-ghost" data-act="edit-family" data-id="${f.id}">تعديل العائلة</button>
        <button class="btn btn-ghost" data-act="delete-family" data-id="${f.id}">حذف العائلة</button></div></div></details>`;
}

// البحث يجري على بيانات الحفلة المفتوحة وحدها، فلا يصل لحفلة أخرى.
function renderList() {
  const tokens = norm(st.query).split(/\s+/).filter(Boolean);
  const hay = (f) => norm([f.name, f.contact_name, f.phone, f.notes, ...f.guests.map((g) => g.full_name)].join(' '));
  const list = tokens.length ? st.families.filter((f) => { const h = hay(f); return tokens.every((t) => h.includes(t)); }) : st.families;
  q('#flist').innerHTML = (tokens.length ? `<p class="muted">${list.length} نتيجة في هذه الحفلة</p>` : '')
    + (list.length ? list.map((f) => familyHtml(f, tokens)).join('')
      : `<p class="card muted">${tokens.length ? 'لا نتائج في هذه الحفلة.' : 'لا توجد عائلات بعد. أضف عائلة أو استورد ملف CSV.'}</p>`);
}
function renderStats() {
  const members = st.families.reduce((s, f) => s + f.members_count, 0);
  const guests = st.families.reduce((s, f) => s + f.guests.length, 0);
  q('#stats').textContent = `${st.families.length} عائلة · ${members} فرداً · ${guests} اسماً`;
}

/* ---------- الأحداث ---------- */
const BUSY = ['make-layout', 'delete-party', 'delete-family', 'delete-guest', 'import-run'];
async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const { act, id } = b.dataset;
  if (BUSY.includes(act)) b.disabled = true;
  try {
    if (act === 'open-party') await showParty(id);
    else if (act === 'back') await showParties();
    else if (act === 'edit-party') { editing = id; renderParties(); }
    else if (act === 'cancel-party') { editing = null; renderParties(); }
    else if (act === 'delete-party') {
      if (confirm('حذف هذه الحفلة وكل عائلاتها وضيوفها؟')) { await api.deleteParty(id); parties = parties.filter((p) => p.id !== id); renderParties(); }
    } else if (act === 'make-layout') opts.openLayout(await api.createLayout(id));
    else if (act === 'open-layout') opts.openLayout(id);
    else if (act === 'open-seating') opts.openSeating(id);
    else if (act === 'toggle-add') q('#add-wrap').hidden = !q('#add-wrap').hidden;
    else if (act === 'cancel-edit') { st.editFamily = st.editGuest = null; q('#add-wrap').hidden = true; renderList(); }
    else if (act === 'edit-family') { st.editFamily = id; renderList(); }
    else if (act === 'edit-guest') { st.editGuest = id; renderList(); }
    else if (act === 'delete-family') await removeFamily(id);
    else if (act === 'delete-guest') await removeGuest(id);
    else if (act === 'import-run') await runImport();
    else if (act === 'import-cancel') { st.preview = null; renderPreview(); }
  } catch (err) { msg(err.message || 'حدث خطأ غير متوقع.'); }
  finally { if (BUSY.includes(act) && b.isConnected) b.disabled = false; }
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target, kind = f.dataset.form, d = Object.fromEntries(new FormData(f));
  const btn = f.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (kind === 'party-new') { await api.createParty(d.name.trim(), d.event_date); await showParties(); }
    else if (kind === 'party-edit') { await api.updateParty(f.dataset.id, { name: d.name.trim(), event_date: d.event_date }); editing = null; await showParties(); }
    else if (kind === 'family-add') await saveFamily(null, d);
    else if (kind === 'family-edit') await saveFamily(f.dataset.id, d);
    else if (kind === 'guest-add') await saveGuest(f.dataset.id, null, d.full_name);
    else if (kind === 'guest-edit') await saveGuest(null, f.dataset.id, d.full_name);
  } catch (err) { msg(err.message || 'حدث خطأ غير متوقع.'); }
  finally { if (btn?.isConnected) btn.disabled = false; }
}

function onInput(e) {
  if (e.target.id === 'search' && st) { st.query = e.target.value; renderList(); }
}
function onToggle(e) {
  const d = e.target;
  if (!st || !d.classList?.contains('family') || d.dataset.auto) return;
  if (d.open) st.open.add(d.dataset.id); else st.open.delete(d.dataset.id);
}
async function onChange(e) {
  if (e.target.id !== 'csv-file' || !st) return;
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('الملف أكبر من 1 ميغابايت.');
    st.preview = buildPreview(await file.text());
    renderPreview();
  } catch (err) { msg(err.message); }
}

/* ---------- العائلات والضيوف ---------- */
function familyData(d) {
  const name = d.name.trim();
  const members = Number(String(d.members_count).trim());
  if (!name) throw new Error('اسم العائلة مطلوب.');
  if (!Number.isInteger(members) || members < 1 || members > 99) throw new Error('عدد الأفراد عدد صحيح من 1 إلى 99.');
  const opt = (v) => v.trim() || null;
  return { name, members_count: members, contact_name: opt(d.contact_name), phone: opt(d.phone), notes: opt(d.notes) };
}

async function saveFamily(id, d) {
  const data = familyData(d);
  if (id) {
    const f = st.families.find((x) => x.id === id);
    if (data.members_count < f.guests.length) throw new Error('عدد الأفراد أقل من عدد الأسماء المسجلة. احذف بعض الأسماء أولاً.');
    Object.assign(f, await api.updateFamily(id, data));
    st.editFamily = null;
  } else {
    const row = await api.createFamily(st.party.id, data);
    st.families.push(row);
    st.families.sort(byName);
    st.open.add(row.id);
    q('#add-wrap').hidden = true;
    q('#add-wrap form').reset();
  }
  renderList();
  renderStats();
}

async function removeFamily(id) {
  const f = st.families.find((x) => x.id === id);
  if (!confirm(`حذف العائلة «${f.name}» وكل أسماء ضيوفها؟`)) return;
  await api.deleteFamily(id);
  st.families = st.families.filter((x) => x !== f);
  renderList();
  renderStats();
}

async function saveGuest(familyId, guestId, nameRaw) {
  const name = nameRaw.trim();
  if (!name) throw new Error('اسم الضيف مطلوب.');
  if (familyId) {
    const f = st.families.find((x) => x.id === familyId);
    if (f.guests.length >= f.members_count) throw new Error('اكتمل عدد الأسماء لهذه العائلة.');
    f.guests.push(await api.addGuest(familyId, name));
    st.open.add(familyId);
  } else {
    const g = await api.updateGuest(guestId, name);
    Object.assign(st.families.flatMap((f) => f.guests).find((x) => x.id === guestId), g);
    st.editGuest = null;
  }
  renderList();
  renderStats();
  if (familyId) q(`details[data-id="${familyId}"] input[name=full_name]`)?.focus();
}

async function removeGuest(id) {
  if (!confirm('حذف هذا الاسم؟')) return;
  await api.deleteGuest(id);
  for (const f of st.families) f.guests = f.guests.filter((g) => g.id !== id);
  renderList();
  renderStats();
}

/* ---------- استيراد CSV (بلا مكتبات) ---------- */
// يدعم الفاصلة والفاصلة المنقوطة والتبويب، وعلامات الاقتباس، وسطراً جديداً داخل الخلية، وBOM.
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) return { rows: [], error: 'ملف CSV غير سليم: علامة اقتباس غير مغلقة.' };
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows: rows.filter((r) => r.some((c) => c.trim() !== '')), error: '' };
}

function buildPreview(text) {
  const { rows, error } = parseCsv(text);
  if (error) throw new Error(error);
  if (rows.length < 2) throw new Error('الملف فارغ أو بلا صفوف بيانات.');
  if (rows.length - 1 > MAX_CSV) throw new Error(`الحد الأقصى ${MAX_CSV} صف في الملف الواحد.`);
  const idx = {};
  rows[0].forEach((h, i) => { for (const f in HEADERS) if (idx[f] === undefined && HEADERS[f].includes(key(h))) idx[f] = i; });
  if (idx.name === undefined || idx.members_count === undefined) throw new Error('الأعمدة المطلوبة غير موجودة: «اسم العائلة» و«عدد الأفراد».');
  const existing = new Set(st.families.map((f) => norm(f.name)));
  const seen = new Set();
  return rows.slice(1).map((r, i) => {
    const cell = (f) => (idx[f] === undefined ? '' : (r[idx[f]] ?? '').trim());
    const data = {
      name: cell('name'), members_count: Number(norm(cell('members_count'))),
      contact_name: cell('contact_name') || null, phone: cell('phone') || null, notes: cell('notes') || null,
      guests: cell('guests').split(/[|؛،;\n]/).map((g) => g.trim()).filter(Boolean),
    };
    let err = '';
    if (!data.name) err = 'اسم العائلة فارغ.';
    else if (data.name.length > 120) err = 'اسم العائلة أطول من 120 حرفاً.';
    else if (!Number.isInteger(data.members_count) || data.members_count < 1 || data.members_count > 99) err = 'عدد الأفراد غير صالح (1 إلى 99).';
    else if (data.guests.length > data.members_count) err = 'عدد الأسماء يتجاوز عدد الأفراد.';
    else if (data.guests.some((g) => g.length > 120) || (data.phone || '').length > 30 || (data.contact_name || '').length > 120 || (data.notes || '').length > 500) err = 'قيمة أطول من الحد المسموح.';
    else if (existing.has(norm(data.name))) err = 'عائلة بهذا الاسم موجودة مسبقاً في الحفلة.';
    else if (seen.has(norm(data.name))) err = 'اسم مكرر داخل الملف.';
    if (!err) seen.add(norm(data.name));
    return { line: i + 2, data, error: err };
  });
}

function renderPreview() {
  const w = q('#import-wrap');
  if (!st.preview) { w.hidden = true; w.innerHTML = ''; return; }
  const ok = st.preview.filter((x) => !x.error), bad = st.preview.filter((x) => x.error);
  w.hidden = false;
  w.innerHTML = `<h3>معاينة الاستيراد</h3><p id="import-summary">${ok.length} عائلة صالحة${bad.length ? ` · ${bad.length} ستُتخطى` : ''}</p>
    ${bad.length ? `<ul class="import-errors">${bad.slice(0, 50).map((x) => `<li>الصف ${x.line}: ${esc(x.data.name || '—')} — ${esc(x.error)}</li>`).join('')}</ul>` : ''}
    <div class="table-wrap"><table class="import-table"><thead><tr><th>العائلة</th><th>الأفراد</th><th>الأسماء</th><th>الهاتف</th></tr></thead>
      <tbody>${ok.slice(0, 20).map((x) => `<tr><td>${esc(x.data.name)}</td><td>${x.data.members_count}</td><td>${x.data.guests.length}</td><td dir="ltr">${esc(x.data.phone || '')}</td></tr>`).join('')}</tbody></table></div>
    ${ok.length > 20 ? `<p class="muted">ويُستورد الباقي (${ok.length - 20}).</p>` : ''}
    <div class="row-actions"><button class="btn btn-primary" data-act="import-run" ${ok.length ? '' : 'disabled'}>استيراد ${ok.length} عائلة</button>
      <button class="btn btn-ghost" data-act="import-cancel">إلغاء</button></div>`;
}

async function runImport() {
  const rows = st.preview.filter((x) => !x.error).map((x) => x.data);
  const n = await api.importFamilies(st.party.id, rows);
  st.preview = null;
  st.families = (await api.listFamilies(st.party.id)).sort(byName);
  renderPreview();
  renderList();
  renderStats();
  msg(`تم استيراد ${n} عائلة.`, true);
}
