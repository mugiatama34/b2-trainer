# CLAUDE.md — B2 Prüfungstrainer

Statik PWA (framework/build yok). Tüm yollar relative (`./…`), site `/b2-trainer/` alt yolunda yayınlanır.

## Kurallar
1. **Her değişiklikte sürümü artır:** `version.json` + `sw.js` içindeki cache adı (`VERSION` → `b2trainer-v<sürüm>`) + `app.js` içindeki `APP_VERSION`. Üçü her zaman aynı olmalı.
2. localStorage anahtarları her zaman `b2trainer:` önekiyle başlar (aynı origin'de başka uygulamalar var).
3. `b2-data.json`'u sadece açıkça istenirse değiştir.
4. API anahtarı koda, repoya, loglara **asla** girmez (sadece kullanıcının cihazında, `b2trainer:apiKey`).

## Notlar
- `version.json` service worker tarafından asla önbelleğe alınmaz; uygulama açılışta ve görünür olunca kontrol eder, farklıysa "Yeni sürüm var" banner'ı çıkar.
- Yeni bir uygulama dosyası eklersen `sw.js` içindeki `APP_FILES` listesine de ekle.
