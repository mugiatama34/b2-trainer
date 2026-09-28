# Görev 5: Schreiben-Coach (fotoğrafla yükleme + değerlendirme + yazma desteği)

CLAUDE.md kuralları geçerli. Mevcut `callClaude()` fonksiyonunu ve Ayarlar'daki API anahtarını kullan. Repodaki `b2-data.json` dosyasını v1.8 ile değiştir: içinde yeni Beschwerde formatı ve 2 yeni yazma kartı var.

Sınavda yazma işi elle yapılıyor. Bu yüzden eşim telefonda yazmayacak: kâğıda yazıp **fotoğrafını çekecek**. Metin girişi sadece yedek yol olarak kalsın.

## 1. Görev seçimi (yeni "Schreiben" ekranı)
Ana sayfaya **Schreiben** butonu ekle. İki sekme olsun:
- **Beschwerde**: `cards` içinden `id` değeri `bs-` ile başlayan kartlar.
  - Görev metni kartın `prompt` alanı.
  - Şef talimatları `"Chef/Chefin schreibt"` başlıklı bloktan gelir.
  - Müşteri şikâyeti `"Kunden-E-Mail (kurz)"` başlıklı bloktan gelir.
- **Forumsbeitrag**: `id` değeri `forum-themen-` ile başlayan kartların satırları.
  - Her satır bir konu: `"Thema — Pro: … | Contra: …"`.
  - Listede sadece `—` işaretinden önceki kısmı göster. Pro/Contra kısmı "İpucu göster" ile açılsın.
  - Ek olarak "Sınav simülasyonu" butonu: rastgele **iki** konu gösterir, eşim birini seçer (sınavdaki gibi).

Görev ekranında:
- Görev metni gösterilir.
- "Yazma desteği" paneli katlanabilir olsun (bkz. 5).
- **Zamanlayıcı** eklenir: Beschwerde için varsayılan 20 dk, Forumsbeitrag için 25 dk; Ayarlar'dan değiştirilebilir.

## 2. Metni yükleme
- **"📷 Fotoğraf çek / yükle"** butonu: `<input type="file" accept="image/*" capture="environment" multiple>`.
  - En fazla **3 sayfa** yüklenebilsin. Küçük önizlemeler gösterilsin, istenen sayfa silinebilsin.
- Her görüntüyü göndermeden önce **canvas ile küçült**: uzun kenar en fazla 1600 px, JPEG kalite 0.8. Böylece istek küçük ve hızlı olur.
- Yedek yol: **"⌨️ Metin olarak gir"** (textarea).
- Fotoğraflar **hiçbir yerde saklanmaz**. Sadece API'ye gönderilir, sonra bellekten silinir.

## 3. İki adımlı analiz
**Adım A – Transkripsiyon** (`PROMPT_TRANSCRIBE`)
- Görüntüler, Claude API'ye `image` blokları olarak gönderilir: `{type:"image", source:{type:"base64", media_type:"image/jpeg", data}}`. Arkasından metin talimatı gelir.
- Gelen metin **düzenlenebilir bir kutuda** gösterilir. Üstünde şu uyarı olsun: *"Okunamayan yerleri düzelt, ama kendi hatalarını düzeltme."*
- `[?]` işaretli yerler vurgulansın.
- Eşim metni kontrol edip **"Değerlendir"** butonuna basar.

**Adım B – Değerlendirme** (Beschwerde için `PROMPT_EVAL_BESCHWERDE`, Forum için `PROMPT_EVAL_FORUM`)
- Promptun içine görev bilgileri (şef talimatları, müşteri şikâyeti ya da forum konusu) ve onaylanmış metin eklenir.
- Sonuç ekranında şunlar gösterilir:
  1. 4 kriter rozeti (A/B/C/D) ve kelime sayısı
  2. **Kontrol listesi**: şef talimatlarının ya da görev maddelerinin her biri için ✅ veya ❌ ve kısa Türkçe yorum. Bu listeyi ekranın en üstüne koy, çünkü en çok puan buradan geliyor.
  3. `summary_tr`
  4. Düzeltmeler: kırmızı (yanlış) → yeşil (doğru) ve Türkçe açıklama
  5. `useful_phrases`: kullanabileceği 5 Redemittel. Her birinin yanında "Kartlara ekle" butonu olsun; eklenenler `b2trainer:myPhrases` altında saklanır ve Kartlar'da "Benim kalıplarım" diye görünür.
  6. `improved_de`: katlanabilir bir "Mustertext" olarak gösterilir, yanında "Vorlesen" butonu.
  7. `tips_tr`
- Geçmiş `b2trainer:writingHistory` altında saklanır: tarih, görev, puanlar ve metin (görüntüler hariç). İlerleme ekranına Schreiben puanları da eklensin.

## 4. Promptlar — `prompts.js` dosyasına ekle

```js
export const PROMPT_TRANSCRIBE = `These images show a handwritten German text by a language learner (exam practice). Transcribe it EXACTLY as written.
Do NOT correct spelling, grammar, capitalization or word order – the errors are important for the evaluation.
Keep paragraph breaks. If a word is unreadable, write your best guess followed by [?].
Output ONLY the transcribed text, nothing else.`;

export const PROMPT_EVAL_BESCHWERDE = `You are an examiner for "Deutsch-Test für den Beruf B2" (telc/BAMF), coaching a Turkish-speaking candidate (a psychologist).
Task type: formal reply e-mail to a customer complaint (Lesen & Schreiben Teil 2).
The candidate's boss gave these instructions, which MUST all appear in the reply:
{{CHEF}}
The customer's complaint (summary): {{KUNDE}}
Writing task: {{TASK}}

Candidate's text (transcribed from handwriting):
"""{{TEXT}}"""

Evaluate:
- checklist: one item per instruction from the boss PLUS "responds to each customer point" PLUS "formal frame (Anrede, Gruß, Sie-Form)". Mark covered true/false with a short Turkish comment.
- scores A/B/C/D (A = B2 gut erfüllt, B = B2 erfüllt, C = B1, D = unter B1) for: aufgabe (all points covered, appropriate), register (polite, formal, fits business context), kohaerenz (structure, paragraphs, connectors), sprache (grammar and vocabulary accuracy/range).
- Focus corrections on the 5-8 most important errors.
Respond ONLY with valid JSON, no markdown:
{"word_count":0,"checklist":[{"point":"...","covered":true,"comment_tr":"..."}],
"scores":{"aufgabe":"A","register":"A","kohaerenz":"A","sprache":"A"},
"summary_tr":"2-3 sentences in Turkish",
"corrections":[{"original":"...","corrected":"...","explanation_tr":"..."}],
"useful_phrases":[{"de":"...","tr":"..."}],
"improved_de":"her e-mail rewritten at solid B2 level, keeping her ideas, including every boss instruction, 120-170 words",
"tips_tr":["3 concrete tips in Turkish"]}`;

export const PROMPT_EVAL_FORUM = `You are an examiner for "Deutsch-Test für den Beruf B2" (telc/BAMF), coaching a Turkish-speaking candidate (a psychologist).
Task type: Forumsbeitrag. Colleagues discuss a new company rule in the internal forum; the candidate gives her opinion.
Topic: {{TOPIC}}

Candidate's text (transcribed from handwriting):
"""{{TEXT}}"""

Evaluate:
- checklist items: "clear personal opinion", "at least two arguments with reasons", "personal example or experience", "considers the other side", "suggestion or compromise", "conclusion", "suitable forum register (friendly, can use du/ihr or neutral)".
- scores A/B/C/D for: aufgabe, register, kohaerenz, sprache (same scale as DTB).
- Focus corrections on the 5-8 most important errors.
Respond ONLY with valid JSON using exactly the same schema as the complaint evaluation; "improved_de" = her text rewritten at solid B2 level, keeping her opinion and ideas, 150-200 words.`;

export const PROMPT_OUTLINE = `A German B2 learner (Turkish, psychologist) has to write the following exam text and wants help to START, not a finished text.
{{TASKINFO}}
Give a paragraph-by-paragraph outline in German: for each paragraph 1 line saying what it should contain and 1-2 sentence starters (only beginnings, max 6 words each, ending with "…"). Do NOT write complete sentences or a model text.
Respond ONLY with JSON: {"paragraphs":[{"goal_tr":"what this paragraph does, in Turkish","starters_de":["…","…"]}]}`;
```

## 5. Yazma desteği (görev ekranında katlanabilir panel)
- **Offline (API gerektirmez), `cards`'tan otomatik gelir:**
  - Beschwerde görevinde: `schreiben-beschwerde` (yapı ve Mustertext), `schreiben-ablehnen`, `schreiben-fehler`, `schreiben-konnektoren` kartları. Görevin talimatlarında "nicht / kein / nicht verantwortlich" gibi ret ifadeleri geçiyorsa `schreiben-ablehnen` kartını en üste koy.
  - Forumsbeitrag görevinde: `schreiben-forum`, `schreiben-fehler`, `schreiben-konnektoren` kartları.
  - Kartlar kısa gösterilsin, yani sadece başlıklar. Dokunulunca açılsın.
- **"🧭 Başlamama yardım et"** butonu (API): `PROMPT_OUTLINE` ile paragraf planı ve cümle başlangıçları gösterir. Hazır metin vermez, bilerek böyle.
- **"Benim kalıplarım"**: 3.5'te kaydedilen Redemittel listesi.
- **Kontrol listesi modu**: Yüklemeden önce görevin maddeleri (şef talimatları) tik atılabilir bir liste olarak gösterilsin. Eşim kâğıda yazarken neyi eklediğini işaretlesin.

## 6. Hata durumları
- Görüntü okunamazsa ya da transkripsiyon çok kısa gelirse (30 kelimeden az) şu mesajı göster: "Fotoğraf net değil, daha aydınlık bir yerde ve düz açıdan tekrar çek."
- Anahtar yoksa: sadece yazma desteğinin offline kısmı ve metin girişi çalışsın. Ayrıca "Prompt'u kopyala" yedeği olsun: görev ve metin tek parça hâlinde kopyalanır, Claude uygulamasına yapıştırılır.

## Teslim sırası
1. Görev seçimi + fotoğraf/metin yükleme + transkripsiyon → push
2. Değerlendirme ekranı + geçmiş → push
3. Yazma desteği paneli + "Başlamama yardım et" + "Benim kalıplarım" → push

Her adımda sürümü artır. README'ye test notu ekle: iPhone'da bir kâğıda 3 satır yaz, fotoğrafını çek, transkripsiyon gelsin.
