-- المرحلة 4: التوزيع الذكي للعائلات على الطاولات.
-- هذا الملف قابل لإعادة التشغيل بأمان: لا يحذف بيانات، ويُكمل ما ينقص (جداول، دوال، مشغّلات، سياسات، صلاحيات).
-- يعتمد على schema.sql و layout.sql و guests.sql. شغّله بعدها مرة واحدة.
-- القرار: يجري التوزيع على المخطط المعتمد فقط. بعد الاعتماد تُقفل الطاولات وسعاتها، فلا تتغير من تحت التوزيع.
-- كل الكتابة عبر دوال RPC للمدير فقط، والجداول للقراءة فقط (RLS).

create table if not exists public.family_seats (
  id         uuid primary key default gen_random_uuid(),
  layout_id  uuid not null references public.party_layouts (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  table_id   uuid not null references public.layout_tables (id) on delete cascade,
  is_locked  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_seats_family_once unique (layout_id, family_id) -- عائلة واحدة لا تُوزَّع مرتين في المخطط
);
create index if not exists family_seats_table_idx on public.family_seats (table_id);

drop trigger if exists family_seats_set_updated_at on public.family_seats;
create trigger family_seats_set_updated_at before update on public.family_seats
  for each row execute function public.set_updated_at();

-- التحقق النهائي: مخطط معتمد، وعائلة وطاولة من نفس الحفلة/المخطط، ومجموع الأفراد على الطاولة لا يتجاوز سعتها.
-- قفل صف الطاولة يمنع تجاوز السعة عند عمليتين متزامنتين.
create or replace function public.check_family_seat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_party uuid; v_fparty uuid; v_members int; v_cap int; v_tlayout uuid; v_used int;
begin
  if tg_op = 'UPDATE' and new.table_id = old.table_id and new.family_id = old.family_id then
    return new; -- تغيير التثبيت فقط
  end if;
  select status, party_id into v_status, v_party from public.party_layouts where id = new.layout_id for share;
  if v_status is distinct from 'approved' then
    raise exception 'التوزيع متاح على مخطط معتمد فقط.';
  end if;
  select party_id, members_count into v_fparty, v_members from public.families where id = new.family_id;
  if v_fparty is distinct from v_party then
    raise exception 'العائلة لا تنتمي لحفلة هذا المخطط.';
  end if;
  select capacity, layout_id into v_cap, v_tlayout from public.layout_tables where id = new.table_id for update;
  if v_tlayout is distinct from new.layout_id then
    raise exception 'الطاولة لا تنتمي لهذا المخطط.';
  end if;
  select coalesce(sum(f.members_count), 0) into v_used
    from public.family_seats s join public.families f on f.id = s.family_id
    where s.table_id = new.table_id and s.family_id <> new.family_id;
  if v_used + v_members > v_cap then
    raise exception 'سعة الطاولة (%) لا تتسع لهذه العائلة. المتبقي: %.', v_cap, greatest(v_cap - v_used, 0);
  end if;
  return new;
end;
$$;
drop trigger if exists family_seats_check on public.family_seats;
create trigger family_seats_check before insert or update on public.family_seats
  for each row execute function public.check_family_seat();

-- زيادة عدد أفراد عائلة موزَّعة لا تتجاوز سعة طاولتها.
create or replace function public.check_family_resize() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.members_count > old.members_count and exists (
    select 1 from public.family_seats s join public.layout_tables t on t.id = s.table_id
    where s.family_id = new.id
      and new.members_count + (select coalesce(sum(f.members_count), 0) from public.family_seats s2
                               join public.families f on f.id = s2.family_id
                               where s2.table_id = t.id and s2.family_id <> new.id) > t.capacity) then
    raise exception 'عدد الأفراد الجديد يتجاوز سعة طاولة العائلة. انقل العائلة إلى طاولة أوسع أولاً.';
  end if;
  return new;
end;
$$;
drop trigger if exists families_resize_seat on public.families;
create trigger families_resize_seat before update of members_count on public.families
  for each row execute function public.check_family_resize();

-- إعادة التوزيع: تستبدل المقاعد غير المثبّتة بالخطة المُرسلة في معاملة واحدة. المثبّتة لا تُمس.
create or replace function public.apply_seating(p_layout_id uuid, p_seats jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_n int := 0;
begin
  if not public.is_admin() then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  perform 1 from public.party_layouts where id = p_layout_id and status = 'approved' for update;
  if not found then
    raise exception 'التوزيع متاح على مخطط معتمد فقط.';
  end if;
  if jsonb_typeof(p_seats) <> 'array' or jsonb_array_length(p_seats) > 2000 then
    raise exception 'خطة التوزيع غير صالحة.';
  end if;
  delete from public.family_seats where layout_id = p_layout_id and not is_locked;
  for s in select value from jsonb_array_elements(p_seats) loop
    if exists (select 1 from public.family_seats
               where layout_id = p_layout_id and family_id = (s ->> 'family_id')::uuid) then
      raise exception 'عائلة مثبّتة أو مكررة في خطة التوزيع.';
    end if;
    insert into public.family_seats (layout_id, family_id, table_id)
      values (p_layout_id, (s ->> 'family_id')::uuid, (s ->> 'table_id')::uuid);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- نقل يدوي: يثبّت المقعد تلقائياً كي لا تغيّره إعادة التوزيع. p_table_id فارغ = إزالة العائلة من طاولتها.
create or replace function public.set_family_seat(p_layout_id uuid, p_family_id uuid, p_table_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  if p_table_id is null then
    perform 1 from public.party_layouts where id = p_layout_id and status = 'approved';
    if not found then
      raise exception 'التوزيع متاح على مخطط معتمد فقط.';
    end if;
    delete from public.family_seats where layout_id = p_layout_id and family_id = p_family_id;
  else
    insert into public.family_seats (layout_id, family_id, table_id, is_locked)
      values (p_layout_id, p_family_id, p_table_id, true)
      on conflict (layout_id, family_id) do update set table_id = excluded.table_id, is_locked = true;
  end if;
end;
$$;

create or replace function public.set_seat_lock(p_layout_id uuid, p_family_id uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  update public.family_seats set is_locked = p_locked where layout_id = p_layout_id and family_id = p_family_id;
  if not found then
    raise exception 'العائلة غير موزَّعة على هذا المخطط.';
  end if;
end;
$$;

revoke execute on function public.apply_seating(uuid, jsonb) from public, anon;
revoke execute on function public.set_family_seat(uuid, uuid, uuid) from public, anon;
revoke execute on function public.set_seat_lock(uuid, uuid, boolean) from public, anon;
grant execute on function public.apply_seating(uuid, jsonb) to authenticated;
grant execute on function public.set_family_seat(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_seat_lock(uuid, uuid, boolean) to authenticated;

-- RLS: قراءة للمدير النشط فقط، ولا كتابة مباشرة من المتصفح.
alter table public.family_seats enable row level security;
drop policy if exists "family_seats_admin_read" on public.family_seats;
create policy "family_seats_admin_read" on public.family_seats
  for select to authenticated using (public.is_admin());
revoke all on public.family_seats from anon, authenticated;
grant select on public.family_seats to authenticated;
