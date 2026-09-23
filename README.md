# مساري | اكتشف اهتماماتك، واختر مستقبلك

منصة اختبار استرشادي لاكتشاف الاهتمامات والتخصصات الجامعية.

## رفع المنصة على GitHub Pages (مجاني)

### 1) إنشاء مستودع على GitHub
1. ادخل إلى [github.com/new](https://github.com/new)
2. Repository name: مثلاً `masari`
3. اختر **Public**
4. **لا** تضَع علامة على "Add a README" (عندنا ملفات جاهزة)
5. اضغط **Create repository**

### 2) رفع الملفات
**الطريقة الأسهل (من الموقع):**
1. في صفحة المستودع اضغط **uploading an existing file**
2. اسحب كل محتويات مجلد `masari-github` (الملفات: `index.html` + مجلد `assets` + هذا الـ README)
3. اكتب رسالة مثل: `رفع منصة مساري`
4. اضغط **Commit changes**

**أو من الطرفية (Git):**
```bash
git init
git add .
git commit -m "رفع منصة مساري"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/masari.git
git push -u origin main
```
استبدل `YOUR_USERNAME` باسم حسابك على GitHub.

### 3) تفعيل GitHub Pages
1. في المستودع: **Settings** → **Pages**
2. تحت **Source** اختر **Deploy from a branch**
3. Branch: **main** والمجلد **/ (root)**
4. اضغط **Save**
5. بعد دقيقة أو دقيقتين يظهر الرابط مثل:
   `https://YOUR_USERNAME.github.io/masari/`

---

## ربط Google Sheet (لحفظ الاسم ورقم الهاتف)

1. أنشئ جدول Google جديد
2. في الصف الأول: `التاريخ | الاسم | الهاتف | المصدر`
3. **Extensions** → **Apps Script**
4. الصق محتوى ملف `google-apps-script.js` واحفظ
5. **Deploy** → **New deployment** → نوع **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. انسخ رابط الـ Web app
7. في `index.html` ابحث عن:
   ```js
   const GOOGLE_SCRIPT_URL = "";
   ```
   والصق الرابط بين علامتي التنصيص، ثم ارفع الملف المعدَّل من جديد إلى GitHub.

---

## الشعارات
ضع صورك الحقيقية في مجلد `assets/`:
- `masari-logo.png` — شعار مساري
- `union-logo-wide.png` — شعار الاتحاد العريض
- `union-mark.png` — أيقونة الاتحاد (اختياري)

الملفات الحالية مؤقتة ويمكن استبدالها في أي وقت.

---

## المطور
[محمد فرح](https://www.facebook.com/share/1DmmdLQL2F/)
