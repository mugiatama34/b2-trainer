# Görev 6: Çok dilli destek (Türkçe · English · Українська)

Amaç: Açıklamalar, arayüz ve AI geri bildirimleri kullanıcının seçtiği dilde olsun. **Sınav içeriği (sorular, metinler, Mustertext, Redemittel) Almanca kalır**; sadece açıklamalar ve yardım metinleri çevrilir.
CLAUDE.md kuralları geçerli; her adımda sürümü artır.

## Adım 1 — Altyapı (önce bunu yap, push et)
1. **Arayüz metinleri**: Koddaki tüm sabit Türkçe metinleri `i18n/ui.tr.json`, `i18n/ui.en.json`, `i18n/ui.uk.json` dosyalarına taşı. Anahtarlar düz olsun: `"home.practice": "Pratik"`. Bir `t(key)` fonksiyonu yaz; eksik anahtarda Türkçeye, o da yoksa anahtarın kendisine düşsün.
2. **Dil seçimi**:
   - İlk açılışta tam ekran bir seçim ekranı göster: 🇹🇷 Türkçe · 🇬🇧 English · 🇺🇦 Українська.
   - Seçim `b2trainer:lang` anahtarında saklanır. Ayarlar'dan değiştirilebilir.
   - Varsayılan değer `navigator.language`'e göre belirlensin (`uk` / `tr`, diğer her şey için `en`).
3. **İçerikten metin okuma kuralı** (JSON'daki çevrilebilir alanlar için tek yardımcı fonksiyon):
   - Sorular ve Lesen: `explanation_${lang}` → yoksa `explanation_tr`. Aynı kural `instructions_${lang}` için de geçerli.
   - Kartlar: `card.i18n?.[lang]?.prompt` ve `card.i18n?.[lang]?.blocks` varsa onlar kullanılır, yoksa kartın kendi alanları.
   - `sections[].name` ve `reading_parts[].name` için: `name_${lang}` → yoksa `name`.
4. Uygulama **çeviriler henüz eklenmemişken de** çalışmalı; eksik yerlerde Türkçe görünür. Bu adımda JSON'a dokunma.

## Adım 2 — İçerik çevirisi (`b2-data.json`)
Bu tek istisna: bu görevde `b2-data.json`'u değiştirmene izin var, ama **sadece yeni alanlar ekleyerek**. Mevcut hiçbir alan, ID, cevap indeksi ya da Almanca metin değişmemeli.

Eklenecek alanlar:
- `questions[]` → `explanation_en`, `explanation_uk`
- `reading[]` → `instructions_en`, `instructions_uk`; `reading[].questions[]` → `explanation_en`, `explanation_uk`
- `sections[]`, `reading_parts[]` → `name_en`, `name_uk`
- `cards[]` → `i18n: { en: {prompt, blocks}, uk: {prompt, blocks} }`
  - **Sadece Türkçe olan kısımları** çevir. Satır Almanca + Türkçe karışıksa (ör. `"zur Verfügung stehen — hazır olmak"`), Almanca kısım aynen kalır, sadece Türkçe kısım değişir.
  - `sample` alanı (Almanca Mustertext) ve `examiner_questions` çevrilmez.

**Çeviri kuralları (sözlük):**
| Türkçe | English | Українська |
|---|---|---|
| Tuzak: | Trap: | Пастка: |
| yan cümle (Nebensatz) | subordinate clause (Nebensatz) | підрядне речення (Nebensatz) |
| fiil sonda / 2. sırada | verb at the end / in 2nd position | дієслово в кінці / на 2-му місці |
| şef | boss | керівник |
| müşteri | customer | клієнт |
| ✓ / ✗ | ✓ / ✗ | ✓ / ✗ |
- Almanca sınav terimleri **çevrilmez**: Teil, Lesen, Hören, Schreiben, Sprechen, Sprachbausteine, richtig/falsch, Beschwerde, Forumsbeitrag, Redemittel, TOP, Protokoll, Willkommensmappe, Betriebsrat, Kündigung vb.
- Açıklamalardaki Almanca alıntılar, `'…'` içindeki ifadeler ve `→ a/b/c` cevap işaretleri **aynen** kalır.
- Ton: kısa, samimi ve net, Türkçe orijinal kadar kısa. Ukraynacada doğal ve sade bir dil kullan; Rusizmlerden kaçın.

**Yöntem:**
- 40–60 maddelik partiler hâlinde çalış: önce `questions`, sonra `reading`, sonra `cards`.
- Her partiden sonra doğrulama script'ini (`tools/check-i18n.mjs`) çalıştır. Script şunları kontrol etsin:
  1. Her çevrilebilir öğede `en` ve `uk` var mı?
  2. Almanca alıntılar (tırnak içleri) ve `→ x` işaretleri korunmuş mu?
  3. ID'ler, `answer` değerleri ve `options` alanları orijinal dosyayla birebir aynı mı? (Kontrol için commit öncesi bir yedek kullan.)
  4. JSON geçerli mi?
- Script temiz geçmeden push etme.
- `meta.version` → `2.1`.

## Adım 3 — AI promptlarının dili
- `prompts.js` içinde kullanıcıya dönük tüm alanları (`summary_tr`, `explanation_tr`, `tips_tr`, `comment_tr`, `goal_tr`, `ok_tr`) dilden bağımsız isimlere çevir: `summary`, `explanation`, `tips`, `comment`, `goal`, `ok`. Kodu buna göre güncelle; geçmiş kayıtlarda eski alan adlarını da okuyabilsin.
- Her prompta şu satırı ekle: `Write every explanation, summary, tip and comment in {{LANG_NAME}}. Corrections and model texts stay in German.`
  - `{{LANG_NAME}}` değerleri: `Turkish` / `English` / `Ukrainian`.
- Promptlardaki "Turkish-speaking candidate (a psychologist)" ifadesini genelleştir: `a candidate whose native language is {{LANG_NAME}}{{PROFESSION}}`.
  - `{{PROFESSION}}`, Ayarlar'daki isteğe bağlı **"Meslek"** alanından gelir. Boşsa hiçbir şey eklenmez; doluysa `, working as {meslek}` eklenir.
  - Eşim için bu alana "Psychologin" yazılacak.

## Adım 4 — Çeviri geri bildirimi (Ukraynalı arkadaşlar gözden geçirecek)
- Açıklama gösterilen her yerde küçük bir **"⚑"** butonu olsun (başlığı: "Çeviri hatası bildir" / "Report translation" / "Повідомити про помилку").
- Dokununca bir kutu açılsın: öğe ID'si, dil, mevcut metin ve bir "önerin" alanı.
- "Gönder" butonu `navigator.share()` ile bu bilgileri paylaşım menüsüne gönderir (WhatsApp/Telegram). Paylaşım yoksa panoya kopyalar.
- Metin formatı, sonradan kolay işlenebilsin diye şöyle olsun:
  `[b2trainer-i18n] id=L2-5-q3 lang=uk | mevcut: … | öneri: …`

## Teslim sırası
1. Adım 1 → push (uygulama Türkçe çalışmaya devam etmeli, dil seçimi görünmeli)
2. Adım 2, partiler hâlinde → her parti sonrası push
3. Adım 3 → push
4. Adım 4 → push

README'ye kısa bir "Çeviri nasıl güncellenir" bölümü ekle: ⚑ ile gelen mesajlar nasıl JSON'a işlenir.
