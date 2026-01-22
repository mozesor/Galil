# Galil – לוח משחקים (GitHub Pages) + עדכון נתונים אוטומטי

האתר קורא את `data.json` מהשורש ומציג:
- טבלת דירוג
- משחקים לפי מחזור
- פילטר “רק משחקי הקבוצה”

## איך מפעילים באתר (GitHub Pages)
1. העלה/י את כל הקבצים מהריפו הזה ל־GitHub.
2. ב־GitHub → Settings → Pages:
   - Source: Deploy from a branch
   - Branch: `main` / root
3. פתח/י את כתובת ה־Pages.

## עדכון אוטומטי של data.json
יש Workflow שמריץ כל 30 דקות:
`.github/workflows/update-data.yml`

הוא מריץ:
- `npm install` בתיקיית `scripts`
- `npm run fetch`
ומעדכן `data.json` בריפו אם יש שינוי.

## הפעלה מקומית לבדיקה
בתיקיית `scripts`:
```bash
npm install
npm run fetch
```
אחרי זה אפשר לפתוח את `index.html` בדפדפן (או להפעיל שרת סטטי קטן).

## הערה על המחזורים
ה־API של Vole לפעמים מחזיר מחזורים ב־0-based (מחזור 0) בעוד שבאתר מוצג מחזור 1.
הסקריפט `scripts/fetch-data.js` מנרמל את המספור כך שיתחיל מ־1.
