# B2 Prüfungstrainer

DTB B2 (Deutsch-Test für den Beruf) için mobil çalışma uygulaması. Statik dosyalar, framework yok; içerik `b2-data.json`'dan yüklenir.

## Adım 1 – Pratik + Kartlar
- Eklendi: Pratik (bölüm/konu filtresi, 10'luk tur, karıştırılmış seçenekler, anında doğru/yanlış + açıklama), Kartlar (Prüfung/Schreiben/Sprechen sekmeleri, detay, Mustertext + Vorlesen, 2 dk konuşma zamanlayıcısı, "öğrendim" işareti).
- İlerleme `localStorage`'da `b2trainer:` önekli anahtarlarla (`progress`, `learned`, `practiceFilter`, `lastDeck`) tutulur.
- Test: `python3 -m http.server` → `http://localhost:8000` aç, Pratik'te bir tur çöz, bir Sprechen kartını "öğrendim" yap, sayfayı yenile → tik ve sayaç duruyor.
