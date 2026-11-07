import { db } from './supabase.js';
import { LOGIN_EMAIL_DOMAIN } from './config.js';

const ROLES = ['admin', 'supervisor'];
const MESSAGES = {
  credentials: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  network: 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.',
  server: 'حدث خطأ أثناء الاتصال بالخادم. حاول مرة أخرى لاحقاً.',
  inactive: 'هذا الحساب معطّل. تواصل مع المدير.',
  noProfile: 'هذا الحساب غير مصرّح له بالدخول إلى المنصة.',
};

// أخطاء رسائلها جاهزة للعرض للمستخدم.
export class AuthError extends Error {}

function connectionError(error) {
  const offline = !navigator.onLine || error.status === 0 || /fetch|network/i.test(error.message);
  return new AuthError(offline ? MESSAGES.network : MESSAGES.server);
}

export async function signOut() {
  const { error } = await db.auth.signOut();
  if (error) await db.auth.signOut({ scope: 'local' }); // يعمل حتى دون اتصال
}

// يعيد ملف المستخدم، أو null إن لم توجد جلسة.
// يقرأ الملف من قاعدة البيانات في كل مرة، فلا يكفي وجود جلسة مخزنة.
export async function loadProfile() {
  const { data, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw connectionError(sessionError);
  if (!data.session) return null;

  const { data: profile, error } = await db
    .from('profiles')
    .select('full_name, username, role, is_active')
    .eq('id', data.session.user.id)
    .maybeSingle();
  if (error) throw connectionError(error);

  if (!profile || !ROLES.includes(profile.role) || !profile.is_active) {
    await signOut();
    throw new AuthError(profile && !profile.is_active ? MESSAGES.inactive : MESSAGES.noProfile);
  }
  return profile;
}

export async function signIn(username, password) {
  const email = `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error.status === 400 ? new AuthError(MESSAGES.credentials) : connectionError(error);
  try {
    return await loadProfile();
  } catch (err) {
    await signOut().catch(() => {});
    throw err;
  }
}
