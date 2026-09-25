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

## Adım 3 – PWA
- Eklendi: `manifest.json` (standalone, `start_url`/`scope` = `./`), iOS meta etiketleri + `apple-touch-icon`, `icons/` (SVG + 180/192/512 PNG), `sw.js` (cache `b2trainer-v1`: JSON network-first, diğer dosyalar cache-first; sadece `b2trainer-` önekli eski cache'leri siler). Uygulama dosyası değişince `sw.js` içindeki `VERSION`'ı artır; yeni soru/kart için sadece `b2-data.json` güncellemek yeterli.
- Yayın: GitHub Pages → main branch, root. Tüm yollar relative, alt klasörde çalışır.
- Test: iPhone Safari'de siteyi aç → Paylaş → Ana Ekrana Ekle → ikondan tam ekran açılır; bir kez açtıktan sonra uçak modunda tekrar aç, pratik/kartlar/ilerleme çalışır.

## Adım 4 – Güncelleme bildirimi (v1.1.0)
- Eklendi: `version.json` (SW önbelleğe almaz), açılışta ve `visibilitychange` ile sürüm kontrolü; farklıysa altta "Yeni sürüm var 🎉 — Yenile" banner'ı → bekleyen SW'ye `SKIP_WAITING`, eski cache'ler silinir, sayfa yenilenir. Kurallar `CLAUDE.md`'de (sürüm üç yerde aynı olmalı).
- Test: siteyi aç, sonra sunucuda `version.json`'u farklı bir sürüme çek (ör. yeni push) → uygulamayı arka plana alıp tekrar aç → banner çıkar; "Yenile" → yeni sürüm yüklenir, banner kaybolur. iPhone'da ana ekrandan (standalone) açıkken de dene.

## Adım 5a–5c – Sprechen-Coach: Ayarlar + Monolog (v1.2.0)
- Eklendi: Ayarlar (API anahtarı `b2trainer:apiKey` sadece cihazda, "Sil", model varsayılan `claude-sonnet-5`, "Bağlantıyı test et"), tek API fonksiyonu `callClaude` (Türkçe hata mesajları, yükleniyor göstergesi), `prompts.js`. Teil 1A kartlarında "Coach ile çalış": 2 dk ses kaydı + Dinle (sadece oturumda), dikte metni, "Bewerten" → A–D puanları, düzeltmeler, Verbesserte Version + Vorlesen, ipuçları; Teil 1B Prüferfragen sesli okunur ve cevaba kısa geri bildirim gelir. Özetler `b2trainer:coachHistory`'de, İlerleme ekranında temaya göre son puanlar.
- Anahtar yoksa ya da API hata verirse yedek mod: "Prompt'u kopyala" → Claude uygulamasına yapıştır.
- Test: Ayarlar → anahtarı gir → "Bağlantıyı test et" ✅; Kartlar → Sprechen → Teil 1A kartı → Coach ile çalış → metni dikte et → Bewerten; İlerleme'de puanlar görünür. Anahtarı silince aynı ekranda sadece "Prompt'u kopyala" çıkar.

## Adım 5d–5e – Partnerli pratik + yedek mod (v1.3.0)
- Eklendi: Teil 2 Smalltalk (Claude iş arkadaşı, "du", karttaki sorulardan biriyle ya da rastgele başlar, 5 tur) ve Teil 3 Lösungswege (durum kartlardan seçilir ya da "Neue Situation" ile üretilir, 6–8 tur). Claude'un mesajları otomatik sesli okunur (`de-DE`, 0.9), susturma butonu var (`b2trainer:coachMute`). "Beenden & bewerten" → konuşma `PROMPT_DIALOG_EVAL` ile değerlendirilir, sonuç Monolog ile aynı formatta, puanlar İlerleme'ye yazılır.
- Yedek mod: anahtar yoksa rol oyunu prompt'u kopyalanır; sohbet ya da değerlendirme hata verirse (ör. 529) ilgili prompt (konuşma dahil) kopyalanıp Claude uygulamasına yapıştırılabilir.
- Test: Sprechen-Coach → Teil 2 → "Gespräch starten" → ses geliyor mu (iPhone'da sessiz mod kapalı olmalı) → dikteyle 2–3 cevap → "Beenden & bewerten". Teil 3 → "Neue Situation" → yeni durum görünür. Ayarlar'dan anahtarı silip aynı ekranları aç → sadece "Prompt'u kopyala".
