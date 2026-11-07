-- تشخيص قاعدة البيانات: للقراءة فقط ولا يغيّر شيئاً. شغّل الجزء 1 في SQL Editor وأرسل لي نتيجته كاملة.
-- يُظهر: الجداول والدوال الناقصة (ومن أي ملف SQL)، وRLS، والسياسات، وصلاحيات الدور authenticated، وحسابات profiles.

-- ===== الجزء 1: الفحص =====
with expected_tables(name, file) as (values
  ('profiles', 'schema.sql'), ('parties', 'layout.sql'), ('hall_versions', 'layout.sql'),
  ('party_layouts', 'layout.sql'), ('layout_tables', 'layout.sql'),
  ('families', 'guests.sql'), ('guests', 'guests.sql'), ('family_seats', 'assignments.sql')),
expected_funcs(name, file) as (values
  ('is_admin', 'schema.sql'), ('set_updated_at', 'schema.sql'),
  ('create_party_layout', 'layout.sql'), ('approve_party_layout', 'layout.sql'), ('validate_table_position', 'layout.sql'),
  ('import_families', 'guests.sql'), ('check_guest_count', 'guests.sql'),
  ('apply_seating', 'assignments.sql'), ('set_family_seat', 'assignments.sql'), ('set_seat_lock', 'assignments.sql')),
checks as (
  select 1 as o, 'table ' || t.name as check_name,
         case when to_regclass('public.' || t.name) is not null then 'OK' else 'MISSING -> شغّل ' || t.file end as status,
         '' as detail
  from expected_tables t
  union all
  select 2, 'function ' || f.name,
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = f.name) then 'OK' else 'MISSING -> شغّل ' || f.file end,
         ''
  from expected_funcs f
  union all
  select 3, 'rls ' || c.relname, case when c.relrowsecurity then 'OK' else 'RLS OFF' end, ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in (select name from expected_tables)
  union all
  select 4, 'policies ' || t.name, case when count(p.policyname) > 0 then 'OK' else 'NO POLICY' end,
         coalesce(string_agg(p.policyname, ', '), '')
  from expected_tables t left join pg_policies p on p.schemaname = 'public' and p.tablename = t.name
  where to_regclass('public.' || t.name) is not null
  group by t.name
  union all
  select 5, 'grant ' || g.tbl || ' ' || g.priv,
         case when to_regclass('public.' || g.tbl) is null then 'n/a (الجدول غير موجود)'
              when (case when g.priv in ('insert', 'update')
                         then has_any_column_privilege('authenticated', 'public.' || g.tbl, g.priv)
                         else has_table_privilege('authenticated', 'public.' || g.tbl, g.priv) end) then 'OK'
              else 'MISSING' end,
         'للدور authenticated'
  from (values ('parties', 'select'), ('parties', 'insert'), ('parties', 'update'), ('parties', 'delete'),
               ('layout_tables', 'update'), ('layout_tables', 'delete'),
               ('families', 'select'), ('families', 'insert'), ('families', 'update'), ('families', 'delete'),
               ('guests', 'select'), ('guests', 'insert'), ('guests', 'update'), ('guests', 'delete'),
               ('family_seats', 'select')) as g(tbl, priv)
  union all
  select 6, 'profile ' || coalesce(username, '?'), 'role=' || role || ' active=' || is_active, ''
  from public.profiles
)
select check_name, status, detail from checks order by o, check_name;

-- ===== الجزء 2 (اختياري، لم أستطع تشغيله هنا): محاكاة عمليات المدير الفعلي =====
-- استبدل المعرّف بمعرّف مستخدم المدير (Authentication > Users > User UID) وشغّل الكتلة كلها دفعة واحدة.
-- يجرّب: is_admin، إضافة حفلة وعائلة وضيف، ثم حذفها. ينتهي بـ rollback فلا يبقى أي أثر.
/*
begin;
create temp table _diag (step text, result text);
grant all on _diag to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
do $$
declare pid uuid; fid uuid; gid uuid;
begin
  begin insert into _diag select 'is_admin()', public.is_admin()::text;
  exception when others then insert into _diag values ('is_admin()', sqlerrm); end;
  begin insert into public.parties (name) values ('__diag__') returning id into pid; insert into _diag values ('insert party', 'OK');
  exception when others then insert into _diag values ('insert party', sqlerrm); end;
  begin insert into public.families (party_id, name, members_count) values (pid, '__diag__', 2) returning id into fid; insert into _diag values ('insert family', 'OK');
  exception when others then insert into _diag values ('insert family', sqlerrm); end;
  begin insert into public.guests (family_id, full_name) values (fid, '__diag__') returning id into gid; insert into _diag values ('insert guest', 'OK');
  exception when others then insert into _diag values ('insert guest', sqlerrm); end;
  begin delete from public.guests where id = gid; insert into _diag values ('delete guest', 'OK');
  exception when others then insert into _diag values ('delete guest', sqlerrm); end;
  begin delete from public.families where id = fid; insert into _diag values ('delete family', 'OK');
  exception when others then insert into _diag values ('delete family', sqlerrm); end;
  begin delete from public.parties where id = pid; insert into _diag values ('delete party', 'OK');
  exception when others then insert into _diag values ('delete party', sqlerrm); end;
end $$;
select * from _diag;
rollback;
*/
