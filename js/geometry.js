// دوال هندسية نقية لمخطط القاعة (بلا DOM). كل الإحداثيات بوحدات المخطط.
// الطاولة دائرة قطرها hall.table_spec.diameter (تشمل الكراسي) ومركزها (x, y).

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function circleHitsRect(c, radius, r) {
  const dx = Math.max(r.x - c.x, 0, c.x - (r.x + r.w));
  const dy = Math.max(r.y - c.y, 0, c.y - (r.y + r.h));
  return Math.hypot(dx, dy) < radius;
}

// يعيد null إن كان الموضع صالحاً، وإلا { reason: 'outside' | 'stage' | 'pool' | 'table', with? }.
export function findConflict(pos, hall, tables, ignoreId = null) {
  const { diameter } = hall.table_spec;
  const radius = diameter / 2;
  if (pos.x - radius < 0 || pos.y - radius < 0 || pos.x + radius > hall.width || pos.y + radius > hall.height) {
    return { reason: 'outside' };
  }
  const feature = hall.features.find((f) => circleHitsRect(pos, radius, f));
  if (feature) return { reason: feature.type };
  const other = tables.find((t) => t.id !== ignoreId && dist(pos, t) < diameter);
  return other ? { reason: 'table', with: other.label } : null;
}

// أقرب موضع شاغر لنقطة البداية (بحث حلقات بخطوة 4 وحدات)، أو null.
export function findFreeSpot(start, hall, tables, step = 4) {
  for (let ring = 0; ring <= 60; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const pos = { x: start.x + dx * step, y: start.y + dy * step };
        if (!findConflict(pos, hall, tables)) return pos;
      }
    }
  }
  return null;
}
