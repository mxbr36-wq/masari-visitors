import { db } from './supabase.js';

export class ApiError extends Error {
  constructor(message, { retryable = false, conflict = false, locked = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.conflict = conflict;
    this.locked = locked;
  }
}

// رسائل قاعدة البيانات المقصودة (P0001) عربية وجاهزة للعرض؛ غيرها لا نكشف تفاصيله.
function toApiError(error) {
  if (!navigator.onLine || /fetch|network/i.test(error.message || '')) {
    return new ApiError('تعذر الاتصال بالخادم.', { retryable: true });
  }
  if (error.code === '23505') return new ApiError('رقم الطاولة مستخدم في هذا المخطط.');
  if (error.code === '42501') return new ApiError('ليست لديك صلاحية لهذه العملية.');
  if (error.code === 'P0001') return new ApiError(error.message, { locked: /مقفل/.test(error.message) });
  return new ApiError('حدث خطأ غير متوقع. حاول مرة أخرى.');
}

const REQUEST_TIMEOUT_MS = 15000;

// مهلة لكل طلب حتى لا يعلق الحفظ إلى الأبد عند انقطاع الشبكة.
export async function run(query) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('انتهت مهلة الاتصال.', { retryable: true })), REQUEST_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([query, timeout]);
    if (error) throw toApiError(error);
    return data;
  } finally { clearTimeout(timer); }
}

const TABLE_COLS = 'id, label, x, y, capacity, updated_at';

export const listParties = () =>
  run(db.from('parties').select('id, name, event_date, party_layouts(id, revision, status)').order('created_at', { ascending: false }));
export const createParty = (name, eventDate) =>
  run(db.from('parties').insert({ name, event_date: eventDate || null }).select('id').single());
export const createLayout = (partyId, copyFrom = null) =>
  run(db.rpc('create_party_layout', { p_party_id: partyId, p_copy_from: copyFrom }));
export const approveLayout = (layoutId) => run(db.rpc('approve_party_layout', { p_layout_id: layoutId }));

export async function loadLayout(layoutId) {
  const layout = await run(
    db.from('party_layouts')
      .select('id, party_id, revision, status, parties(name), hall_versions(width, height, table_spec, features)')
      .eq('id', layoutId).single(),
  );
  const tables = await run(db.from('layout_tables').select(TABLE_COLS).eq('layout_id', layoutId).order('label'));
  return { layout, tables };
}

export const fetchTable = (id) => run(db.from('layout_tables').select(TABLE_COLS).eq('id', id).maybeSingle());
export const insertTable = (layoutId, t) =>
  run(db.from('layout_tables').insert({ layout_id: layoutId, label: t.label, x: t.x, y: t.y }).select(TABLE_COLS).single());
export const deleteTable = (id) => run(db.from('layout_tables').delete().eq('id', id));

// الحفظ مشروط بآخر updated_at معروف: إن تغيّر الصف من جلسة أخرى لا يُكتب شيء ويُعدّ تعارضاً.
export async function saveTable(t) {
  const rows = await run(
    db.from('layout_tables')
      .update({ label: t.label, x: t.x, y: t.y, capacity: t.capacity })
      .eq('id', t.id).eq('updated_at', t.updated_at).select('updated_at'),
  );
  if (!rows.length) throw new ApiError('عُدِّلت هذه الطاولة من جلسة أخرى.', { conflict: true });
  return rows[0].updated_at;
}

// حفظ تلقائي بعد توقف التعديل.
// - انقطاع الاتصال: إعادة محاولة تدريجية، والتعديلات تبقى في الذاكرة ولا تُهمل.
// - خطأ دائم أو تعارض في طاولة لا يمنع حفظ بقية الطاولات، لكنه يبقى ظاهراً حتى يُعالج.
// - إن نجحت الكتابة وضاع الرد فالمقارنة مع الخادم تمنع تعارضاً كاذباً.
export function createAutosaver({ delay = 800, onStatus, onConflict, onLocked = () => {} }) {
  const dirty = new Map(), conflicted = new Set(), failed = new Map();
  let timer = null, current = null, attempts = 0;
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(flush, ms); };
  const same = (s, t) => s.label === t.label && Number(s.x) === t.x && Number(s.y) === t.y && s.capacity === t.capacity;

  async function drain() {
    let net = null;
    for (;;) {
      const t = [...dirty.values()].find((x) => !conflicted.has(x.id) && !failed.has(x.id));
      if (!t) break;
      const rev = t._rev;
      onStatus('saving');
      try {
        t.updated_at = await saveTable(t);
        if (t._rev === rev) dirty.delete(t.id);
      } catch (e) {
        if (e.conflict) {
          try {
            const s = await fetchTable(t.id);
            if (s && same(s, t)) { t.updated_at = s.updated_at; if (t._rev === rev) dirty.delete(t.id); continue; }
          } catch (e2) { net = e2; break; }
          conflicted.add(t.id);
          onConflict(t);
        } else if (e.retryable) { net = e; break; }
        else { failed.set(t.id, `${t.label}: ${e.message}`); if (e.locked) onLocked(); }
      }
    }
    if (net) {
      onStatus('error', net.message, net.retryable);
      if (net.retryable) schedule(Math.min(30000, 2000 * 2 ** attempts++));
    } else if (conflicted.size) onStatus('conflict');
    else if (failed.size) onStatus('error', [...failed.values()][0]);
    else { attempts = 0; onStatus('saved'); }
  }
  function flush() {
    clearTimeout(timer);
    current ??= drain().finally(() => { current = null; });
    return current;
  }
  return {
    touch(t) { t._rev = (t._rev || 0) + 1; failed.delete(t.id); dirty.set(t.id, t); onStatus('saving'); schedule(delay); },
    flush,
    retry() { failed.clear(); return flush(); },
    pending: () => dirty.size,
    resolve: (id) => conflicted.delete(id),
    drop(id) { dirty.delete(id); conflicted.delete(id); failed.delete(id); },
    stop() { clearTimeout(timer); dirty.clear(); conflicted.clear(); failed.clear(); },
  };
}
