# Görev 2: Güncelleme bildirimi + Sprechen-Coach (Claude API)

TASK.md'deki adımlar bittiyse buradan devam et. Bitmediyse önce onları tamamla. Aynı kurallar geçerli: statik site, relative yollar, `b2trainer:` localStorage öneki, `b2-data.json`'u değiştirme.

## Adım 4 — Güncelleme bildirimi (önce bunu yap, küçük iş)

- Repoya `version.json` ekle: `{"version": "1.0.0"}`.
- `sw.js` içindeki cache adı aynı sürümü içersin (`b2trainer-v1.0.0`).
- Uygulama açılışta ve `visibilitychange` ile görünür olduğunda `./version.json?t=<timestamp>` dosyasını `cache: "no-store"` ile çeksin. SW bu dosyayı **asla** önbelleğe almasın.
- Sunucudaki sürüm, yüklü sürümden farklıysa ekranın altında sabit bir banner göster: **"Yeni sürüm var 🎉 — Yenile"**.
- Butona basınca bekleyen SW'ye `SKIP_WAITING` mesajı gönder, eski cache'leri sil, `location.reload()` çağır. iOS'ta ana ekran (standalone) modunda test et.
- **Repoya `CLAUDE.md` ekle** ve içine şu kuralları yaz:
  1. Her değişiklikte sürümü artır: `version.json` + `sw.js` içindeki cache adı + `app.js` içindeki `APP_VERSION`. Üçü her zaman aynı olmalı.
  2. localStorage anahtarları her zaman `b2trainer:` önekiyle başlar.
  3. `b2-data.json`'u sadece açıkça istenirse değiştir.
  4. API anahtarı koda, repoya, loglara **asla** girmez.

## Adım 5 — Sprechen-Coach

### 5a. Ayarlar ekranı
- **API anahtarı** alanı (`type=password`), `b2trainer:apiKey` anahtarında sadece cihazda saklanır. Yanında "Sil" butonu olsun.
- **Model** alanı, varsayılan `claude-sonnet-5`.
- **"Bağlantıyı test et"** butonu: kısa bir istek gönderir, ✅ veya hata mesajı gösterir.
- Anahtar yoksa Coach ekranları sadece yedek modu (5e) gösterir.

### 5b. API çağrısı (tek fonksiyon: `callClaude(system, messages)`)
- İstek: `POST https://api.anthropic.com/v1/messages`
- Header'lar: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`, `anthropic-dangerous-direct-browser-access: true`
- `max_tokens`: değerlendirmede 2000, sohbette 400.
- Cevaptaki `content` içinden `type:"text"` bloklarını birleştir. JSON beklenen yerlerde ```` ``` ```` işaretlerini temizleyip `JSON.parse` et. Parse başarısız olursa ham metni göster.
- Hata mesajları Türkçe olsun: 401 → "Anahtar hatalı", 429/529 → "Yoğunluk var, 10 sn sonra tekrar dene", ağ hatası → "İnternet yok".
- Yükleniyor göstergesi ekle, istek sürerken butonu kilitle.

### 5c. Mod 1 — Monolog (Teil 1A + 1B)
Her `sprechen-t1-*` kartında **"Coach ile çalış"** butonu olsun. Akış:
1. Tema ve Stichpunkte'ler gösterilir.
2. **Kayıt**: 2 dakikalık zamanlayıcı ve MediaRecorder ile ses kaydı. "Dinle" ile kaydı tekrar oynatabilsin. Kayıt sadece oturumda tutulur, bir yere gönderilmez.
3. **Metin kutusu**: "Klavyedeki 🎤 simgesine bas ve tekrar konuş" ipucu. Dikte ile metin oluşur.
4. **"Bewerten"** butonu → `PROMPT_MONOLOG` ile değerlendirme. Sonuç ekranında:
   - 4 kriter puanı (A/B/C/D rozetleri)
   - `summary_tr`
   - Düzeltmeler listesi: yanlış hâli (kırmızı) → doğru hâli (yeşil) ve Türkçe açıklama
   - `improved_de` metni ve yanında "Vorlesen" butonu
   - `tips_tr`
5. **Prüferfragen**: değerlendirme 2 takip sorusu üretir. Soru sesli okunur (TTS), o dikteyle cevaplar, `PROMPT_FOLLOWUP` ile kısa geri bildirim alır.
6. Her değerlendirmenin özeti (tarih, tema, puanlar) `b2trainer:coachHistory` altında saklanır. İlerleme ekranında her tema için son puanlar görünsün.

### 5d. Mod 2 ve 3 — Partnerli pratik (Teil 2 Smalltalk, Teil 3 Lösungswege)
- Sohbet arayüzü kullanılır. Claude'un her mesajı otomatik olarak sesli okunur (`de-DE`, hız 0.9). Susturma butonu da olsun.
- O, dikte ile metin kutusuna yazar ve gönderir.
- **T2**: Claude bir iş arkadaşı rolündedir ve "du" diye hitap eder. Karttaki sorulardan biriyle ya da rastgele bir smalltalk sorusuyla başlar. 5 tur sürer (`PROMPT_T2`).
- **T3**: Durum `sprechen-t3*` kartlarından seçilir. Bir de "Neue Situation" butonu olsun: Claude işyerinden yeni bir sorun üretir. Claude partner rolündedir. 6–8 tur sürer (`PROMPT_T3`).
- **"Beenden & bewerten"** butonu: tüm konuşma `PROMPT_DIALOG_EVAL` ile değerlendirilir. Sonuç 5c'deki formatta gösterilir.

### 5e. Yedek mod (anahtar yoksa veya API hata verirse)
- "Prompt'u kopyala" butonu: ilgili değerlendirme promptunu (system + görev + metni tek parça hâlinde) panoya kopyalar.
- Ardından "Claude uygulamasına yapıştır" talimatını gösterir.

### 5f. Promptlar — `prompts.js` dosyasına aynen koy

```js
export const PROMPT_MONOLOG = `You are an experienced examiner for the German exam "Deutsch-Test für den Beruf B2" (telc/BAMF), coaching a Turkish-speaking candidate who is a psychologist.
The candidate spoke for about 2 minutes on the task below; the text is an iPhone DICTATION transcript. Ignore punctuation, capitalization and obvious dictation artifacts. Do NOT evaluate pronunciation.

Evaluate with these criteria, each rated A (B2 gut erfüllt), B (B2 erfüllt), C (B1), D (unter B1):
1 Aufgabenerfüllung – were all task points covered, with examples, roughly 2 minutes of content?
2 Kohärenz – clear structure, introduction/conclusion, connectors
3 Wortschatz – range and precision, work-related vocabulary
4 Strukturen – grammar accuracy: verb position, cases, articles, subordinate clauses, tenses

Be encouraging but honest. Focus on the 5–8 most important, recurring errors, not every small slip.
Respond ONLY with valid JSON, no markdown:
{"scores":{"aufgabe":"A|B|C|D","kohaerenz":"...","wortschatz":"...","strukturen":"..."},
"summary_tr":"2-3 sentences in Turkish",
"corrections":[{"original":"...","corrected":"...","explanation_tr":"short Turkish explanation"}],
"improved_de":"her text rewritten at solid B2 level, keeping her content and personal details, 180-230 words",
"tips_tr":["3 concrete tips in Turkish"],
"followup_questions_de":["2 short examiner follow-up questions about her talk"]}`;

export const PROMPT_FOLLOWUP = `You are a DTB B2 examiner. The candidate (Turkish, psychologist) answered a follow-up question (dictation transcript; ignore punctuation). Give brief feedback.
Respond ONLY with JSON: {"ok_tr":"1 sentence what was good (Turkish)","corrections":[{"original":"...","corrected":"...","explanation_tr":"..."}],"better_answer_de":"a model answer, 3-4 sentences, B2"}`;

export const PROMPT_T2 = `Role-play: you are a friendly colleague of the candidate in a German workplace, small talk (DTB B2 Sprechen Teil 2). Use "du". Speak natural, simple B2 German, 1-3 sentences per turn, and always end with a question or a reaction that invites her to continue. Do not correct her during the conversation. After about 5 exchanges, wrap up naturally. Never switch to Turkish.`;

export const PROMPT_T3 = `Role-play for DTB B2 Sprechen Teil 3 "Lösungswege diskutieren". You are the candidate's colleague. Situation: {{SITUATION}}
Discuss how to react: immediate steps, who does what, contacting people involved, long-term improvement. Use "du". Make realistic suggestions, sometimes politely disagree or propose an alternative, so she must argue and negotiate. Keep turns to 1-3 sentences. Do not correct her. After 6-8 exchanges, ask her to summarize what you agreed. German only.`;

export const PROMPT_DIALOG_EVAL = `You are a DTB B2 examiner. Below is a dialogue between the candidate (Turkish, psychologist; her turns are iPhone dictation, ignore punctuation) and a partner (AI). Evaluate ONLY the candidate's turns for task type {{TASK}}.
Criteria rated A/B/C/D as in DTB: aufgabe (reacting appropriately, making suggestions, agreeing/disagreeing, distributing tasks, asking back), kohaerenz, wortschatz, strukturen.
Respond ONLY with the same JSON schema as the monologue evaluation, but "improved_de" contains 4-6 of her turns rewritten at B2 level (format "Du: ... → Besser: ..."), and "followup_questions_de" is an empty array.`;
```

## Teslim sırası
1. Adım 4 → push (sürüm 1.1.0, banner'ı test et).
2. 5a + 5b + 5c → push.
3. 5d + 5e → push.

Her adımda `CLAUDE.md` kuralına göre sürümü artır. README'ye kısa test notu ekle.
