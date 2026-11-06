// خوارزمية التوزيع وملخصاته (دوال نقية بلا DOM).
// السلوك المعتمد: Best-Fit Decreasing بلا تقسيم. العائلات الأكبر أولاً، وكل عائلة كاملة على الطاولة
// التي يتبقى فيها أقل عدد مقاعد يكفيها. العائلة التي لا تتسع لها أي طاولة تبقى غير موزَّعة مع سبب واضح، ولا تُقسَّم أبداً.

export const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

// tables: [{id,label,capacity}] ، families: [{id,name,members_count}] ، seats: [{family_id,table_id,is_locked}]
// المقاعد المثبّتة تبقى وتُخصم من سعة طاولاتها، والباقي يُعاد توزيعه.
export function planSeating({ tables, families, seats }) {
  const locked = seats.filter((s) => s.is_locked);
  const lockedFamilies = new Set(locked.map((s) => s.family_id));
  const size = new Map(families.map((f) => [f.id, f.members_count]));
  const remaining = new Map(tables.map((t) => [t.id, t.capacity]));
  for (const s of locked) {
    if (remaining.has(s.table_id)) remaining.set(s.table_id, remaining.get(s.table_id) - (size.get(s.family_id) ?? 0));
  }
  const order = [...tables].sort((a, b) => natural(a.label, b.label));
  const pending = families
    .filter((f) => !lockedFamilies.has(f.id))
    .sort((a, b) => b.members_count - a.members_count || a.name.localeCompare(b.name, 'ar'));
  const placed = [], unplaced = [];
  for (const f of pending) {
    let best = null;
    for (const t of order) {
      const r = remaining.get(t.id);
      if (r >= f.members_count && (best === null || r < remaining.get(best.id))) best = t;
    }
    if (best) {
      remaining.set(best.id, remaining.get(best.id) - f.members_count);
      placed.push({ family_id: f.id, table_id: best.id });
    } else unplaced.push(f.id);
  }
  return { placed, unplaced };
}

export function summarize({ tables, families, seats }) {
  const fam = new Map(families.map((f) => [f.id, f]));
  const perTable = new Map(tables.map((t) => [t.id, { table: t, used: 0, families: [] }]));
  const seated = new Set();
  for (const s of seats) {
    const f = fam.get(s.family_id), row = perTable.get(s.table_id);
    if (!f || !row) continue;
    row.used += f.members_count;
    row.families.push({ family: f, locked: s.is_locked });
    seated.add(f.id);
  }
  const rows = [...perTable.values()].sort((a, b) => natural(a.table.label, b.table.label));
  const maxCap = Math.max(0, ...tables.map((t) => t.capacity));
  const maxFree = Math.max(0, ...rows.map((r) => r.table.capacity - r.used));
  const unseated = families.filter((f) => !seated.has(f.id)).sort((a, b) => b.members_count - a.members_count)
    .map((f) => ({
      family: f,
      reason: f.members_count > maxCap ? `أكبر من سعة أي طاولة (${maxCap})` : `لا توجد طاولة بمقاعد كافية (أكبر متبقٍ ${maxFree})`,
    }));
  const seatedPeople = rows.reduce((n, r) => n + r.used, 0);
  const totalCap = tables.reduce((n, t) => n + t.capacity, 0);
  return {
    rows, unseated, seatedPeople, totalCap,
    seatedFamilies: seated.size,
    unseatedPeople: unseated.reduce((n, u) => n + u.family.members_count, 0),
    free: totalCap - seatedPeople,
    overflow: rows.filter((r) => r.used > r.table.capacity),
  };
}
