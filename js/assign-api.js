import { db } from './supabase.js';
import { run, listParties } from './layout-api.js';
import { listFamilies } from './parties-api.js';

// يُحمَّل توزيع حفلة واحدة: أحدث مخطط معتمد لها فقط، وعائلاتها هي، ومقاعد ذلك المخطط. لا تختلط الحفلات.
export async function loadSeating(partyId) {
  const party = (await listParties()).find((p) => p.id === partyId);
  if (!party) throw new Error('الحفلة غير موجودة.');
  const approved = await run(db.from('party_layouts').select('id, revision').eq('party_id', partyId).eq('status', 'approved'));
  const layout = [...approved].sort((a, b) => b.revision - a.revision)[0] ?? null;
  const families = await listFamilies(partyId);
  if (!layout) return { party, layout: null, tables: [], families, seats: [] };
  const [tables, seats] = await Promise.all([
    run(db.from('layout_tables').select('id, label, capacity').eq('layout_id', layout.id)),
    run(db.from('family_seats').select('family_id, table_id, is_locked').eq('layout_id', layout.id)),
  ]);
  return { party, layout, tables, families, seats };
}

export const applySeating = (layoutId, seats) => run(db.rpc('apply_seating', { p_layout_id: layoutId, p_seats: seats }));
export const setFamilySeat = (layoutId, familyId, tableId) =>
  run(db.rpc('set_family_seat', { p_layout_id: layoutId, p_family_id: familyId, p_table_id: tableId }));
export const setSeatLock = (layoutId, familyId, locked) =>
  run(db.rpc('set_seat_lock', { p_layout_id: layoutId, p_family_id: familyId, p_locked: locked }));
