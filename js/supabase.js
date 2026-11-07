import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

// رسالة المشكلة إن وُجدت، وإلا null.
export const connectionProblem = !isConfigured
  ? 'لم يتم إعداد الاتصال بـ Supabase بعد. راجع الملف js/config.js.'
  : !window.supabase
    ? 'تعذر تحميل مكتبة Supabase. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.'
    : null;

export const db = connectionProblem
  ? null
  : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
