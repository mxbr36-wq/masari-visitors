-- المرحلة 2: الحفلات ومخطط القاعة. يعتمد على schema.sql (is_admin و set_updated_at).
-- شغّله بعد schema.sql وقبل hall_seed.sql، مرة واحدة.
-- كل الجداول للمدير فقط. المشرف لا يرى شيئاً هنا في هذه المرحلة.

create table public.parties (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) > 0),
  event_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- شكل القاعة الثابت. لا يُعدَّل بعد إنشائه؛ أي تغيير يُضاف كإصدار جديد فلا تتأثر المخططات السابقة.
create table public.hall_versions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  version        int not null check (version > 0),
  width          numeric not null check (width > 0),
  height         numeric not null check (height > 0),
  table_spec     jsonb not null, -- {diameter, table_radius, chairs}
  features       jsonb not null, -- معالم ثابتة ممنوع وضع الطاولات فوقها: [{type,label,x,y,w,h}]
  default_tables jsonb not null, -- الترتيب الابتدائي: [{label,x,y}] بلا أسماء أو حجوزات
  created_at     timestamptz not null default now(),
  unique (name, version)
);

-- مخطط لكل حفلة. بعد الاعتماد يُقفل، والتعديل عبر نسخة جديدة (revision).
create table public.party_layouts (
  id              uuid primary key default gen_random_uuid(),
  party_id        uuid not null references public.parties (id) on delete cascade,
  hall_version_id uuid not null references public.hall_versions (id),
  revision        int not null check (revision > 0),
  status          text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at     timestamptz,
  approved_by     uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (party_id, revision)
);

create table public.layout_tables (
  id         uuid primary key default gen_random_uuid(),
  layout_id  uuid not null references public.party_layouts (id) on delete cascade,
  label      text not null check (char_length(trim(label)) between 1 and 10),
  x          numeric not null,
  y          numeric not null,
  capacity   int check (capacity between 1 and 99), -- فارغة حتى يحددها المدير
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (layout_id, label)
);

create trigger parties_set_updated_at before update on public.parties
  for each row execute function public.set_updated_at();
create trigger party_layouts_set_updated_at before update on public.party_layouts
  for each row execute function public.set_updated_at();
create trigger layout_tables_set_updated_at before update on public.layout_tables
  for each row execute function public.set_updated_at();

-- قفل: لا تعديل على طاولات مخطط معتمد.
create function public.block_approved_layout_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid; v_status text;
begin
  if tg_op = 'DELETE' then target := old.layout_id; else target := new.layout_id; end if;
  -- for share: يمنع اعتماد المخطط أثناء تعديل جارٍ (وبالعكس). يتطلب صلاحية UPDATE، لذلك الدالة security definer.
  select status into v_status from public.party_layouts where id = target for share;
  if v_status = 'approved' then
    raise exception 'المخطط معتمد ومقفل. أنشئ نسخة جديدة للتعديل.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger layout_tables_lock before insert or update or delete on public.layout_tables
  for each row execute function public.block_approved_layout_edit();

-- حارس المخطط: لا تغيير بعد الاعتماد، والاعتماد يتطلب طاولات وسعات محددة.
create function public.guard_layout_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved' then
    raise exception 'المخطط معتمد ومقفل.';
  end if;
  if new.status = 'approved' then
    if not exists (select 1 from public.layout_tables where layout_id = old.id) then
      raise exception 'لا توجد طاولات في المخطط.';
    end if;
    if exists (select 1 from public.layout_tables where layout_id = old.id and capacity is null) then
      raise exception 'حدّد سعة كل الطاولات قبل الاعتماد.';
    end if;
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger party_layouts_guard before update on public.party_layouts
  for each row execute function public.guard_layout_update();

-- تحقق من الموضع في القاعدة: داخل حدود القاعة، لا فوق المنصة أو المسبح، ولا تداخل مع طاولة أخرى في المخطط نفسه.
create function public.validate_table_position() returns trigger
language plpgsql set search_path = '' as $$
declare h record; f jsonb; r numeric; dx numeric; dy numeric;
begin
  if tg_op = 'UPDATE' and new.x = old.x and new.y = old.y then return new; end if;
  select hv.width, hv.height, hv.features, (hv.table_spec ->> 'diameter')::numeric as diameter into h
    from public.party_layouts pl join public.hall_versions hv on hv.id = pl.hall_version_id
    where pl.id = new.layout_id;
  r := h.diameter / 2;
  if new.x - r < 0 or new.y - r < 0 or new.x + r > h.width or new.y + r > h.height then
    raise exception 'الطاولة خارج حدود القاعة.';
  end if;
  for f in select value from jsonb_array_elements(h.features) loop
    dx := greatest((f ->> 'x')::numeric - new.x, 0, new.x - ((f ->> 'x')::numeric + (f ->> 'w')::numeric));
    dy := greatest((f ->> 'y')::numeric - new.y, 0, new.y - ((f ->> 'y')::numeric + (f ->> 'h')::numeric));
    if sqrt(dx * dx + dy * dy) < r then
      raise exception 'الطاولة فوق معلم ثابت (المنصة أو المسبح).';
    end if;
  end loop;
  if exists (select 1 from public.layout_tables t
             where t.layout_id = new.layout_id and t.id <> new.id
               and sqrt(power(t.x - new.x, 2) + power(t.y - new.y, 2)) < h.diameter) then
    raise exception 'الطاولة تتداخل مع طاولة أخرى.';
  end if;
  return new;
end;
$$;
create trigger layout_tables_validate before insert or update on public.layout_tables
  for each row execute function public.validate_table_position();

-- إنشاء مخطط: من الترتيب الابتدائي لآخر إصدار قاعة (لحفلة بلا مخطط)، أو نسخة من مخطط معتمد (تحتفظ بإصدار قاعته).
-- لا مسودة ثانية لنفس الحفلة، ويُقفل صف الحفلة لمنع التكرار عند الطلبات المتزامنة.
create function public.create_party_layout(p_party_id uuid, p_copy_from uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hall uuid; v_id uuid; v_rev int;
begin
  if not public.is_admin() then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  perform 1 from public.parties where id = p_party_id for update;
  if not found then
    raise exception 'الحفلة غير موجودة.';
  end if;
  if exists (select 1 from public.party_layouts where party_id = p_party_id and status = 'draft') then
    raise exception 'لهذه الحفلة مخطط قيد التحرير. تابع العمل عليه أو اعتمده أولاً.';
  end if;
  select coalesce(max(revision), 0) + 1 into v_rev from public.party_layouts where party_id = p_party_id;
  if p_copy_from is null then
    if v_rev > 1 then
      raise exception 'للحفلة مخطط سابق. أنشئ نسخة جديدة من المخطط المعتمد.';
    end if;
    select id into v_hall from public.hall_versions order by version desc, created_at desc limit 1;
  else
    select hall_version_id into v_hall from public.party_layouts
      where id = p_copy_from and party_id = p_party_id and status = 'approved';
    if v_hall is null then
      raise exception 'يمكن النسخ من مخطط معتمد لهذه الحفلة فقط.';
    end if;
  end if;
  if v_hall is null then
    raise exception 'تعذر تحديد إصدار القاعة.';
  end if;
  insert into public.party_layouts (party_id, hall_version_id, revision)
    values (p_party_id, v_hall, v_rev) returning id into v_id;
  if p_copy_from is null then
    insert into public.layout_tables (layout_id, label, x, y)
      select v_id, t ->> 'label', (t ->> 'x')::numeric, (t ->> 'y')::numeric
      from public.hall_versions h, jsonb_array_elements(h.default_tables) t
      where h.id = v_hall;
  else
    insert into public.layout_tables (layout_id, label, x, y, capacity)
      select v_id, label, x, y, capacity from public.layout_tables where layout_id = p_copy_from;
  end if;
  return v_id;
end;
$$;

create function public.approve_party_layout(p_layout_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  update public.party_layouts set status = 'approved' where id = p_layout_id;
  if not found then
    raise exception 'المخطط غير موجود.';
  end if;
end;
$$;

revoke execute on function public.create_party_layout(uuid, uuid) from public, anon;
revoke execute on function public.approve_party_layout(uuid) from public, anon;
grant execute on function public.create_party_layout(uuid, uuid) to authenticated;
grant execute on function public.approve_party_layout(uuid) to authenticated;

-- RLS: المدير النشط فقط.
alter table public.parties enable row level security;
alter table public.hall_versions enable row level security;
alter table public.party_layouts enable row level security;
alter table public.layout_tables enable row level security;

create policy "parties_admin" on public.parties
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "hall_versions_admin_read" on public.hall_versions
  for select to authenticated using (public.is_admin());
create policy "party_layouts_admin_read" on public.party_layouts
  for select to authenticated using (public.is_admin());
create policy "layout_tables_admin" on public.layout_tables
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- صلاحيات الجداول (طبقة ثانية): المخططات لا تُنشأ ولا تُعتمد إلا عبر الدالتين أعلاه.
revoke all on public.parties, public.hall_versions, public.party_layouts, public.layout_tables from anon, authenticated;
grant select on public.parties, public.hall_versions, public.party_layouts, public.layout_tables to authenticated;
grant insert (name, event_date) on public.parties to authenticated;
grant update (name, event_date) on public.parties to authenticated;
grant insert (layout_id, label, x, y, capacity) on public.layout_tables to authenticated;
grant update (label, x, y, capacity) on public.layout_tables to authenticated;
grant delete on public.layout_tables to authenticated;
