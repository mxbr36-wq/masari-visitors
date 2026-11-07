import * as api from './assign-api.js';
import { natural, planSeating, summarize } from './seating.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let root, opts, st = null, busy = false;
const q = (sel) => root.querySelector(sel);

export function mountSeating(container, options) {
  root = container;
  opts = options;
  root.onclick = onClick;
  root.onchange = onChange;
  return refresh();
}
export function leaveSeating() {
  if (!root) return;
  root.onclick = root.onchange = null;
  st = null;
}

let msgTimer;
function msg(text, ok = false) {
  const m = q('#msg');
  if (!m) return;
  m.textContent = text;
  m.hidden = !text;
  m.classList.toggle('is-ok', ok);
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { m.hidden = true; }, 8000);
}

async function refresh() {
  try {
    st = { ...(await api.loadSeating(opts.partyId)), showEmpty: st?.showEmpty ?? false };
  } catch (err) {
    root.innerHTML = `<p class="form-error">${esc(err.message)}</p><button class="btn btn-ghost" data-act="back">رجوع</button>`;
    return;
  }
  render();
}

// تنفيذ عملية واحدة في كل مرة، مع عرض أي خطأ.
async function act(fn) {
  if (busy) return msg('جارٍ تنفيذ عملية سابقة. انتظر لحظة ثم أعد المحاولة.');
  busy = true;
  try { await fn(); } catch (err) { msg(err.message || 'حدث خطأ غير متوقع.'); } finally { busy = false; }
}

const header = () => `<div class="layout-bar"><button class="btn btn-ghost" data-act="back">رجوع</button>
  <div class="layout-title"><strong>توزيع العائلات · ${esc(st.party.name)}</strong>${st.layout ? `<span class="chip">مخطط نسخة ${st.layout.revision} · معتمد</span>` : ''}</div></div>`;

function render() {
  if (!st.layout) {
    const last = [...st.party.party_layouts].sort((a, b) => b.revision - a.revision)[0];
    root.innerHTML = `<div class="parties-view">${header()}<section class="card"><h3>لا يوجد مخطط معتمد</h3>
      <p class="muted">التوزيع يتطلب مخططاً معتمداً لهذه الحفلة، لأن اعتماده يُقفل الطاولات وسعاتها. حدّد سعات الطاولات ثم اعتمد المخطط.</p>
      ${last ? `<button class="btn btn-primary" data-act="open-layout" data-id="${last.id}">فتح المخطط</button>` : '<p class="muted">أنشئ مخططاً من «إدارة الحفلات».</p>'}</section></div>`;
    return;
  }
  const sum = summarize(st);
  const options = (size, exceptId) => sum.rows
    .filter((r) => r.table.id !== exceptId && r.table.capacity - r.used >= size)
    .map((r) => `<option value="${r.table.id}">${esc(r.table.label)} · متبقٍ ${r.table.capacity - r.used}</option>`).join('');
  const hasUnlocked = st.seats.some((s) => !s.is_locked);
  const shown = sum.rows.filter((r) => st.showEmpty || r.families.length);

  const card = (r) => {
    const pct = Math.min(100, Math.round((r.used / r.table.capacity) * 100));
    const cls = r.used > r.table.capacity ? 'over' : r.used === r.table.capacity ? 'full' : '';
    return `<article class="table-card"><header><strong>طاولة ${esc(r.table.label)}</strong>
      <span class="muted">${r.used}/${r.table.capacity} · متبقٍ ${r.table.capacity - r.used}</span></header>
      <div class="bar ${cls}"><i style="width:${pct}%"></i></div>
      <ul class="seat-list">${r.families.map(({ family: f, locked }) => `<li>
        <span><strong>${esc(f.name)}</strong> <span class="muted">${f.members_count} أفراد</span>${locked ? ' <span class="badge">مثبّت</span>' : ''}</span>
        <span class="row-actions"><button class="btn btn-ghost" data-act="lock" data-family="${f.id}" data-locked="${locked ? '' : '1'}">${locked ? 'إلغاء التثبيت' : 'تثبيت'}</button>
          <select data-move="${f.id}" aria-label="نقل العائلة ${esc(f.name)}"><option value="">نقل إلى...</option>${options(f.members_count, r.table.id)}</select>
          <button class="btn btn-ghost" data-act="unseat" data-family="${f.id}">إزالة</button></span></li>`).join('') || '<li class="muted">طاولة فارغة</li>'}</ul></article>`;
  };

  root.innerHTML = `<div class="parties-view">${header()}
    <section class="card seat-summary">
      <div class="stat"><b>${sum.seatedFamilies}</b><span>عائلة موزَّعة (${sum.seatedPeople} فرداً)</span></div>
      <div class="stat"><b>${sum.unseated.length}</b><span>عائلة غير موزَّعة (${sum.unseatedPeople} فرداً)</span></div>
      <div class="stat"><b>${sum.free}</b><span>مقعد متبقٍ من ${sum.totalCap}</span></div>
      ${sum.overflow.length ? `<p class="form-error">تجاوز سعة في ${sum.overflow.length} طاولة: ${esc(sum.overflow.map((r) => r.table.label).join('، '))}</p>` : ''}</section>
    <div class="layout-tools"><button class="btn btn-primary" data-act="distribute" ${st.families.length ? '' : 'disabled'}>${hasUnlocked ? 'إعادة التوزيع' : 'توزيع تلقائي'}</button>
      <label class="check"><input type="checkbox" id="show-empty" ${st.showEmpty ? 'checked' : ''}> إظهار الطاولات الفارغة</label>
      <span class="muted">المثبّتة لا تتغير عند إعادة التوزيع. النقل اليدوي يثبّت العائلة تلقائياً.</span></div>
    <p id="msg" class="form-error" hidden></p>
    ${sum.unseated.length ? `<section class="card unseated"><h3>عائلات غير موزَّعة (${sum.unseated.length})</h3><ul class="seat-list">${sum.unseated.map(({ family: f, reason }) => `<li>
      <span><strong>${esc(f.name)}</strong> <span class="muted">${f.members_count} أفراد · ${esc(reason)}</span></span>
      <select data-move="${f.id}" aria-label="وضع العائلة ${esc(f.name)} على طاولة"><option value="">وضع على...</option>${options(f.members_count, null)}</select></li>`).join('')}</ul></section>` : ''}
    <div class="seat-grid">${shown.map(card).join('') || '<p class="card muted">لا توزيع بعد. اضغط «توزيع تلقائي».</p>'}</div></div>`;
}

async function distribute() {
  if (st.seats.some((s) => !s.is_locked) && !confirm('ستُعاد جدولة كل العائلات غير المثبّتة، وتبقى المثبّتة كما هي. هل تريد المتابعة؟')) return;
  await refresh(); // بيانات حديثة قبل الحساب
  const { placed, unplaced } = planSeating(st);
  await api.applySeating(st.layout.id, placed);
  await refresh();
  msg(`تم توزيع ${placed.length} عائلة${unplaced.length ? `، وتعذّر توزيع ${unplaced.length} (الأسباب في قائمة غير الموزَّعة)` : ''}.`, true);
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const { act: name, id, family, locked } = b.dataset;
  if (name === 'back') opts.back();
  else if (name === 'open-layout') opts.openLayout(id);
  else if (name === 'distribute') act(distribute);
  else if (name === 'lock') act(async () => { await api.setSeatLock(st.layout.id, family, Boolean(locked)); await refresh(); });
  else if (name === 'unseat') act(async () => { await api.setFamilySeat(st.layout.id, family, null); await refresh(); });
}

function onChange(e) {
  const t = e.target;
  if (t.id === 'show-empty' && st) { st.showEmpty = t.checked; render(); return; }
  if (t.dataset?.move && t.value) {
    act(async () => {
      try { await api.setFamilySeat(st.layout.id, t.dataset.move, t.value); } finally { await refresh(); }
      msg('تم النقل وتثبيت العائلة على الطاولة الجديدة.', true);
    });
  }
}
