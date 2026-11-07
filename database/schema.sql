-- المرحلة 1: جدول ملفات المستخدمين وسياسات RLS.
-- شغّل هذا الملف مرة واحدة من Supabase > SQL Editor.

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (char_length(trim(full_name)) > 0),
  username   text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  role       text not null default 'supervisor' check (role in ('admin', 'supervisor')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- دالة مساعدة تتجاوز RLS عمداً (security definer) لتفادي التكرار اللانهائي داخل السياسات.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- قراءة فقط: المستخدم يقرأ ملفه، والمدير النشط يقرأ كل الملفات.
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "profiles_select_admin" on public.profiles
  for select to authenticated using (public.is_admin());

-- لا توجد سياسات insert/update/delete، فيُرفض أي تعديل من المتصفح (RLS).
-- ونسحب الصلاحيات أيضاً كطبقة حماية ثانية. التعديل يتم من لوحة Supabase فقط في هذه المرحلة.
-- عند إضافة إدارة المستخدمين لاحقاً: أضف سياسة تعديل للمدير فقط، ولا تمنح المستخدم تعديل role أو is_active.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
