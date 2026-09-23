/**
 * مساري — سكربت Google Apps Script لحفظ الاسم ورقم الهاتف في جدول
 *
 * خطوات الإعداد:
 * 1) افتح Google Drive → جديد → جداول Google (Google Sheets)
 * 2) في الصف الأول اكتب العناوين: التاريخ | الاسم | الهاتف | المصدر
 * 3) من القائمة: الإضافات (Extensions) → Apps Script
 * 4) احذف أي كود موجود، والصق هذا الملف كاملاً، ثم احفظ
 * 5) نشر (Deploy) → New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6) انسخ رابط Web app (ينتهي غالباً بـ /exec)
 * 7) الصق الرابط في ملف index.html مكان:
 *    const GOOGLE_SCRIPT_URL = "الصق_الرابط_هنا";
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var data = {};

    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        data = { raw: e.postData.contents };
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    var name = String(data.name || "").trim();
    var phone = String(data.phone || "").trim();
    var source = String(data.source || "masari");
    var at = data.at ? new Date(data.at) : new Date();

    if (!name && !phone) {
      return jsonOut({ ok: false, error: "empty" });
    }

    // تأكد من وجود عناوين في الصف الأول
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["التاريخ", "الاسم", "الهاتف", "المصدر"]);
    }

    sheet.appendRow([at, name, phone, source]);

    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut({
    ok: true,
    message: "مساري — جاهز لاستقبال الطلبات (POST)"
  });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
