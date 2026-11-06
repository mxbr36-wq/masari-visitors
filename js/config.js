// إعدادات الاتصال. استخدم Project URL والمفتاح العام (anon / publishable) فقط.
// ممنوع وضع service_role أو أي مفتاح سري هنا.
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbGhtb2t2Zmpla254cnltY21sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NjMyNjYsImV4cCI6MjEwOTUzOTI2Nn0.rUZuWUo0UpaAJ2xgFDym-rE1tvTYC-csRZueMhtzND0';

// تسجيل الدخول باسم المستخدم: يُحوَّل داخلياً إلى username@النطاق.
// يجب أن يطابق هذا النطاق بريد الحسابات التي تنشئها في Supabase.
export const LOGIN_EMAIL_DOMAIN = 'users.hafalat.example.com';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');
