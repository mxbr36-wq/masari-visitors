import { db } from './supabase.js';
import { run } from './layout-api.js';

export { listParties, createParty, createLayout } from './layout-api.js';

const FAMILY_COLS = 'id, name, members_count, contact_name, phone, notes, guests(id, full_name)';

export const updateParty = (id, { name, event_date }) =>
  run(db.from('parties').update({ name, event_date: event_date || null }).eq('id', id).select('id'));
export const deleteParty = (id) => run(db.from('parties').delete().eq('id', id));

// كل الاستعلامات مقيّدة بـ party_id، فلا تختلط بيانات الحفلات.
export const listFamilies = (partyId) => run(db.from('families').select(FAMILY_COLS).eq('party_id', partyId));
export const createFamily = (partyId, f) => run(db.from('families').insert({ party_id: partyId, ...f }).select(FAMILY_COLS).single());
export const updateFamily = (id, f) => run(db.from('families').update(f).eq('id', id).select(FAMILY_COLS).single());
export const deleteFamily = (id) => run(db.from('families').delete().eq('id', id));

export const addGuest = (familyId, fullName) =>
  run(db.from('guests').insert({ family_id: familyId, full_name: fullName }).select('id, full_name').single());
export const updateGuest = (id, fullName) =>
  run(db.from('guests').update({ full_name: fullName }).eq('id', id).select('id, full_name').single());
export const deleteGuest = (id) => run(db.from('guests').delete().eq('id', id));

export const importFamilies = (partyId, rows) => run(db.rpc('import_families', { p_party_id: partyId, p_rows: rows }));
