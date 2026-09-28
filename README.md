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

## Görev 3 – Lesen modülü (v1.4.0)
- Eklendi: Ana sayfada **📖 Lesen**. Liste `reading_parts` sırasına göre gruplanır, her setin yanında en iyi skor (ör. 4/5). Set ekranında `instructions_tr` + `context_de`; **matching** setlerde katlanabilir metin kartları (key rozeti) ve soru başına key butonları (`allow_none` ise `x`); **text-questions** setlerde metin üstte yapışkan, kaydırılabilir bir panelde (birden fazla metin varsa T1/T2 sekmeleri, aşağı kaydırınca ya da cevap verince ilgili sekme otomatik açılır; "Metni büyüt" ile genişler), `rf` = richtig/falsch, `mc` = a/b/c (seçenekler karıştırılmaz). Altta sabit **Kontrol et**: o zamana kadar cevap gösterilmez; sonra yeşil/kırmızı, doğru cevap ve `explanation_tr` açılır, "Tekrar çöz". İsteğe bağlı zamanlayıcı (varsayılan kapalı; matching 10 dk, diğerleri 12 dk; süre bitince otomatik kontrol). Metinde bir kelimeye uzun basınca (masaüstünde çift tıklayınca) vurgulanır (sadece o ekranda kalır).
- Kayıt `b2trainer:reading`: set başına `best`, `last`, `total`, son yanlış soru id'leri (`wrong`) ve toplam `ok`/`n`. İlerleme ekranında her `reading_parts` için doğru yüzdesi; "İlerlemeyi sıfırla" Lesen skorlarını da siler. Kartlar'da `lesen` destesi "Lesen" sekmesi olarak görünür, strateji kartlarından alıştırmalara link var.
- Test: Ana sayfa → Lesen → "Lesen T3 · Set 1" → bir metni aç, 2 soruyu cevapla → Kontrol et (boş soru uyarısı) → renkler + açıklamalar; listeye dön → skor görünür. "Lesen T2 · Set 1" → aşağı kaydırınca T2 sekmesi kendiliğinden açılır; zamanlayıcıyı aç → üstte ⏱ 12:00. İlerleme → Lesen barları. Kartlar → Lesen sekmesi. iPhone'da metinde bir kelimeye uzun bas → sarı vurgu.

## Görev 4 – Coach süresi + veri v1.3 (v1.5.0)
- Eklendi: Ayarlar → "Monolog süresi" (2/3/4 dk, varsayılan 3; `b2trainer:settings.monologMinutes`). Coach Monolog kaydı ve Sprechen kartlarındaki zamanlayıcı bu süreyi kullanır. 2:00'de kısa titreşim + "Sınavda burada durdurulabilirsin" notu (süre 2 dk'dan uzunsa); süre bitince titreşim + yanıp sönen kırmızı sayaç + "Süre doldu!". `PROMPT_MONOLOG`: 2–3 dk içerik, örnek metin 230-300 kelime. `b2-data.json` v1.3: 18 Lesen seti + "Tuzak tipleri" kartı (kod değişikliği yok).
- Test: Ayarlar → Monolog süresi 3 dk → Kartlar → Sprechen → bir Teil 1 kartı → zamanlayıcı 3:00 → Başlat → 1:00 kalınca (2:00 geçti) titreşim + not; 0:00'da titreşim + kırmızı yanıp sönme. Coach ile çalış → "Kayıt (3 dk)". Ayarı 4 dk yapıp tekrar aç → 4:00. Lesen listesinde 18 set; Kartlar → Lesen'de "Tuzak tipleri" kartı.

## Veri v1.7 (v1.5.3)
- `b2-data.json` v1.7 (manuel güncelleme): 132 soru, 58 kart (Sprechen 30, Schreiben 20, Lesen 6, Prüfung 2), 38 Lesen seti. Kod değişikliği yok; sadece sürüm 1.5.3'e çekildi (banner + yeni SW cache).
- Test: uygulamayı aç → "Yeni sürüm var" banner'ı → Yenile; Lesen listesinde 38 set, Kartlar sekmelerinde yeni kartlar görünür.

## Veri v1.8 (v1.5.4)
- `b2-data.json` v1.8 (manuel güncelleme): 2 yeni Schreiben kartı ("En sık hatalar" kontrol listesi, "Bağlaç çantası"). Toplam 60 kart (Schreiben 22). Kod değişikliği yok.
- Test: banner → Yenile; Kartlar → Schreiben'de iki yeni kart görünür.

## Görev 5 – Schreiben-Coach
### Adım 1 – Görev seçimi + fotoğraf/metin yükleme + transkripsiyon (v1.6.0)
- Eklendi: Ana sayfada **✍️ Schreiben**. İki sekme: **Beschwerde** (`bs-*` kartları; görev = `prompt`, şef talimatları = "Chef/Chefin schreibt", müşteri = "Kunden-E-Mail (kurz)") ve **Forumsbeitrag** (`forum-themen-*` kartlarının satırları; listede sadece `—` öncesi, 💡 ile Pro/Contra). "🎲 Sınav simülasyonu": rastgele iki konu, birini seç.
- Görev ekranı: görev metni + zamanlayıcı (Beschwerde 20 dk, Forum 25 dk; Ayarlar → Schreiben; çalışırken süre üst barda, son 5 dk'da titreşim + not, sonunda "Süre doldu!").
- **📷 Fotoğraf çek / yükle** (`capture="environment"`, çoklu) + "🖼 Galeriden seç": en fazla 3 sayfa, önizleme, × ile sil. Her foto canvas ile küçültülür (uzun kenar ≤ 1600 px, JPEG 0.8). **📝 Metni oku** → `PROMPT_TRANSCRIBE` (görüntüler `image` blokları + metin talimatı). Metin düzenlenebilir kutuda, üstte uyarı; `[?]` yerleri vurgulanır. Fotoğraflar hiçbir yerde saklanmaz: cevap gelince bellekten silinir. 30 kelimeden kısa gelirse "Fotoğraf net değil…" uyarısı. Yedek yol: **⌨️ Metin olarak gir**. Metin taslağı `b2trainer:writingDraft:<görev>` altında tutulur (görüntüler değil).
- Anahtar yoksa foto butonu yerine not + metin kutusu.
- Test (iPhone): Ayarlar'da anahtar kayıtlı → Schreiben → Beschwerde → bir görev → **bir kâğıda 3 satır yaz, 📷 ile fotoğrafını çek → "Metni oku" → transkripsiyon kutuda gelir** (3 satır < 30 kelime olduğu için "Fotoğraf net değil" notu da çıkar — bu beklenen davranış). Forumsbeitrag → 💡 → Pro/Contra açılır; Sınav simülasyonu → iki konu.

### Adım 2 – Değerlendirme + geçmiş (v1.6.1)
- Eklendi: **Değerlendir** → `PROMPT_EVAL_BESCHWERDE` (şef talimatları + müşteri şikâyeti + görev + metin) ya da `PROMPT_EVAL_FORUM` (konu + metin; Beschwerde JSON şeması eklenir). `[?]` işaretleri gönderilmeden silinir.
- Sonuç: en üstte **Kontrol listesi** (✅/❌ + Türkçe yorum), 4 rozet (Aufgabe/Register/Kohärenz/Sprache) + kelime sayısı, `summary_tr`, düzeltmeler (kırmızı → yeşil), 5 Redemittel ("➕ Kartlara ekle" → `b2trainer:myPhrases`, Kartlar'da **Benim kalıplarım** sekmesi; 🔊 ve 🗑), katlanabilir **Mustertext** + Vorlesen, `tips_tr`.
- Geçmiş `b2trainer:writingHistory` (tarih, görev, puanlar, kelime, kontrol listesi skoru, metin; görüntü yok). İlerleme'de "Schreiben · son puanlar", Schreiben listesinde görev yanında son puanlar. "İlerlemeyi sıfırla" Schreiben puanlarını da siler (kalıplar kalır).
- Anahtar yoksa ya da API hata verirse: "📋 Prompt'u kopyala" (görev + metin tek parça) → Claude uygulamasına yapıştır.
- Test: bir görevde metni yaz/oku → Değerlendir → kontrol listesi en üstte; bir Redemittel'i ekle → Kartlar → Benim kalıplarım'da görünür; İlerleme'de Schreiben puanı. Anahtarı sil → aynı ekranda sadece metin kutusu + "Prompt'u kopyala".

### Adım 3 – Yazma desteği + "Başlamama yardım et" + "Benim kalıplarım" (v1.6.2)
- Eklendi: Görev ekranında **✅ Görev maddeleri** (yüklemeden önce tik atılabilir liste; Beschwerde'de şef talimatları cümle cümle + "müşterinin her şikâyeti" + "resmî çerçeve", Forum'da 7 madde).
- Katlanabilir **🧰 Yazma desteği** (offline, `cards`'tan): Beschwerde → `schreiben-beschwerde` (yapı + Mustertext + Vorlesen), `schreiben-ablehnen`, `schreiben-fehler`, `schreiben-konnektoren`; şef talimatında ret ifadesi (kein…, nicht verantwortlich, bleiben bestehen…) varsa `schreiben-ablehnen` en üstte. Forum → `schreiben-forum`, `schreiben-fehler`, `schreiben-konnektoren`. Sadece başlıklar, dokununca açılır.
- **🧭 Başlamama yardım et** (`PROMPT_OUTLINE`): paragraf başına Türkçe amaç + Almanca cümle başlangıçları (hazır metin yok). Anahtar yoksa prompt kopyalanabilir.
- **Benim kalıplarım**: kaydedilen Redemittel panelde listelenir.
- Test: Schreiben → "Drucker – nicht unsere Schuld" → Yazma desteği'ni aç → ilk kart "Höflich ablehnen"; bir maddeyi işaretle → sayaç artar; "Başlamama yardım et" → paragraf planı. Forum konusunda 3 kart + 7 madde.
