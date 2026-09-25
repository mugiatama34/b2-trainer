# B2 Prüfungstrainer

DTB B2 (Deutsch-Test für den Beruf) için mobil çalışma uygulaması. Statik dosyalar, framework yok; içerik `b2-data.json`'dan yüklenir.

## Adım 1 – Pratik + Kartlar
- Eklendi: Pratik (bölüm/konu filtresi, 10'luk tur, karıştırılmış seçenekler, anında doğru/yanlış + açıklama), Kartlar (Prüfung/Schreiben/Sprechen sekmeleri, detay, Mustertext + Vorlesen, 2 dk konuşma zamanlayıcısı, "öğrendim" işareti).
- İlerleme `localStorage`'da `b2trainer:` önekli anahtarlarla (`progress`, `learned`, `practiceFilter`, `lastDeck`) tutulur.
- Test: `python3 -m http.server` → `http://localhost:8000` aç, Pratik'te bir tur çöz, bir Sprechen kartını "öğrendim" yap, sayfayı yenile → tik ve sayaç duruyor.

## Adım 2 – Tekrar + Sınav modu + İlerleme
- Eklendi: Leitner tekrar (`b2trainer:srs`, kutu 0–4; yanlış → kutu 0 ve tur sonunda tekrar; doğru → 1/2/4/7 gün), 20 soruluk zamanlı Sınav modu (süre ayarlanabilir, `b2trainer:settings`), bölüm/konu bazlı İlerleme ekranı + en zayıf 3 konu + onaylı sıfırlama.
- Ana sayfa "X soru tekrar bekliyor" sayısını gösterir; tüm modlardaki cevaplar tekrar kutularını günceller.
- Test: Sınav modunda süreyi 1 dk yapıp birkaç soruyu yanlış cevapla → süre bitince skor + yanlışlar listesi; ana sayfada tekrar sayısı artar, Tekrar'da yanlış cevaplanan soru tur sonunda tekrar gelir; İlerleme'de barları kontrol et.
