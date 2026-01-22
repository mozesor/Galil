# Galil – לוח משחקים (GitHub Pages)

## מה יש פה
- `index.html` מציג משחקים + טבלה + בחירת מחזור.
- `data.json` מתעדכן אוטומטית ע"י GitHub Actions כל 30 דקות.
- תיקון מספור: אם המחזורים מגיעים מ-0, אנחנו מזיזים +1 כדי להתאים לאתר.

## בדיקה מקומית (חשוב!)
אל תפתח `index.html` עם double click (file://) — הדפדפן חוסם קריאת JSON.
פתח עם שרת פשוט, לדוגמה:

### Windows (PowerShell) – Python
```powershell
python -m http.server 8000
```
ואז:
http://localhost:8000

או תשתמש ב־VSCode Live Server.

## הפעלת GitHub Pages
Settings → Pages → Deploy from a branch → main / root


### עיצוב כחול
האתר כולל רקע כחול עם איור (assets/bg-tree.svg). אם לא רואים את הרקע — ודא שהתיקייה assets עלתה ל-GitHub Pages.
