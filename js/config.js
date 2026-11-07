// إعدادات الاتصال. استخدم Project URL والمفتاح العام (anon / publishable) فقط.
// ممنوع وضع service_role أو أي مفتاح سري هنا.
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-OR-PUBLISHABLE-KEY';

// تسجيل الدخول باسم المستخدم: يُحوَّل داخلياً إلى username@النطاق.
// يجب أن يطابق هذا النطاق بريد الحسابات التي تنشئها في Supabase.
export const LOGIN_EMAIL_DOMAIN = 'users.hafalat.example.com';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');
