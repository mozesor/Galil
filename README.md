# Galil – לוח משחקים (GitHub Pages)

דף סטטי שמציג נתונים מתוך `data.json` ומציג "מפת יריבות" (הפועל גליל עליון במרכז).

## איך זה מתעדכן?
Workflow בשם **Update data.json** מריץ את `scripts/fetch-data.js` ומעדכן את `data.json` אוטומטית.

## קבצים חשובים
- `index.html` – האתר
- `data.json` – נתונים
- `debug_endpoints.json` – דיבאג
- `.github/workflows/update-data.yml` – אוטומציה
- `scripts/` – סקריפט משיכה
- `assets/bg-tree.svg` – רקע
