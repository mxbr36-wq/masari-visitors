-- المرحلة 3: العائلات والضيوف. يعتمد على schema.sql و layout.sql (جدول parties). شغّله بعدهما مرة واحدة.
-- كل شيء للمدير فقط. كل عائلة مرتبطة بحفلة واحدة، وكل ضيف بعائلة واحدة، فلا اختلاط بين الحفلات.

create table public.families (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references public.parties (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 120),
  members_count int not null check (members_count between 1 and 99),
  contact_name  text check (char_length(contact_name) <= 120),
  phone         text check (char_length(phone) <= 30),
  notes         text check (char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.guests (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  full_name  text not null check (char_length(trim(full_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index families_party_idx on public.families (party_id);
create index guests_family_idx on public.guests (family_id);

create trigger families_set_updated_at before update on public.families
  for each row execute function public.set_updated_at();
create trigger guests_set_updated_at before update on public.guests
  for each row execute function public.set_updated_at();

-- عدد أسماء الضيوف لا يتجاوز عدد أفراد العائلة. قفل صف العائلة يمنع التجاوز عند الإضافة المتزامنة.
create function public.check_guest_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_members int; v_count int;
begin
  select members_count into v_members from public.families where id = new.family_id for update;
  if v_members is null then return new; end if;
  select count(*) into v_count from public.guests where family_id = new.family_id;
  if v_count + 1 > v_members then
    raise exception 'عدد الأسماء يتجاوز عدد أفراد العائلة (%).', v_members;
  end if;
  return new;
end;
$$;
create trigger guests_count before insert on public.guests
  for each row execute function public.check_guest_count();

-- تقليل عدد الأفراد لا يكون أقل من عدد الأسماء المسجلة.
create function public.check_members_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.members_count < old.members_count
     and (select count(*) from public.guests where family_id = new.id) > new.members_count then
    raise exception 'عدد الأفراد أقل من عدد الأسماء المسجلة. احذف بعض الأسماء أولاً.';
  end if;
  return new;
end;
$$;
create trigger families_members before update of members_count on public.families
  for each row execute function public.check_members_count();

-- حذف الحفلة مسموح فقط إن لم يكن لها مخطط (المخططات المعتمدة مقفلة).
create function public.guard_party_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.party_layouts where party_id = old.id) then
    raise exception 'لا يمكن حذف حفلة لها مخطط.';
  end if;
  return old;
end;
$$;
create trigger parties_guard_delete before delete on public.parties
  for each row execute function public.guard_party_delete();

-- استيراد عائلات (مع ضيوفها) دفعة واحدة: كل شيء أو لا شيء. التحقق الأساسي في الواجهة، وهذا تحقق نهائي.
create function public.import_families(p_party_id uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; g text; v_id uuid; v_n int := 0;
begin
  if not public.is_admin() then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  perform 1 from public.parties where id = p_party_id for update;
  if not found then
    raise exception 'الحفلة غير موجودة.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'ملف الاستيراد يجب أن يحتوي من 1 إلى 1000 صف.';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if length(trim(coalesce(r ->> 'name', ''))) = 0 then
      raise exception 'الصف % بلا اسم عائلة.', v_n + 1;
    end if;
    if coalesce(r ->> 'members_count', '') !~ '^[0-9]{1,2}$' or (r ->> 'members_count')::int < 1 then
      raise exception 'الصف %: عدد الأفراد غير صالح.', v_n + 1;
    end if;
    if jsonb_array_length(coalesce(r -> 'guests', '[]'::jsonb)) > (r ->> 'members_count')::int then
      raise exception 'الصف %: عدد الأسماء يتجاوز عدد الأفراد.', v_n + 1;
    end if;
    insert into public.families (party_id, name, members_count, contact_name, phone, notes)
      values (p_party_id, trim(r ->> 'name'), (r ->> 'members_count')::int,
              nullif(trim(r ->> 'contact_name'), ''), nullif(trim(r ->> 'phone'), ''), nullif(trim(r ->> 'notes'), ''))
      returning id into v_id;
    for g in select jsonb_array_elements_text(coalesce(r -> 'guests', '[]'::jsonb)) loop
      insert into public.guests (family_id, full_name) values (v_id, trim(g));
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.import_families(uuid, jsonb) from public, anon;
grant execute on function public.import_families(uuid, jsonb) to authenticated;

-- RLS: المدير النشط فقط.
alter table public.families enable row level security;
alter table public.guests enable row level security;
create policy "families_admin" on public.families
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "guests_admin" on public.guests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- صلاحيات الجداول (طبقة ثانية). لا يمكن نقل عائلة لحفلة أخرى ولا ضيف لعائلة أخرى.
revoke all on public.families, public.guests from anon, authenticated;
grant select on public.families, public.guests to authenticated;
grant insert (party_id, name, members_count, contact_name, phone, notes) on public.families to authenticated;
grant update (name, members_count, contact_name, phone, notes) on public.families to authenticated;
grant delete on public.families to authenticated;
grant insert (family_id, full_name) on public.guests to authenticated;
grant update (full_name) on public.guests to authenticated;
grant delete on public.guests to authenticated;
grant delete on public.parties to authenticated;
