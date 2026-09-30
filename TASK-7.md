# Görev 7: İçerik temizliği (patch v2.2)

**Ön koşul:** TASK-6 tamamen bitmiş olmalı. Çeviriler `b2-data.json` içinde duruyor olmalı.
CLAUDE.md kuralları geçerli.

## Amaç
Bazı içerikler resmî sınav materyallerine fazla yakın. Bunlar tamamen yeni, özgün versiyonlarla değiştiriliyor. Değişecek nesneler repodaki `patch-v2.2.json` dosyasında hazır; bu dosyayı repo köküne koydum.

## Adımlar
1. **Yedek al:** `cp b2-data.json tools/b2-data.before-v2.2.json`. Bu dosyayı commit etme; `.gitignore`'a ekle.
2. **Değiştir:** `patch-v2.2.json` içindeki `replace.cards`, `replace.reading` ve `replace.questions` (varsa) listelerindeki her nesne için, `b2-data.json`'da **aynı `id`'ye sahip nesneyi bütünüyle** yenisiyle değiştir.
   - Sıra korunmalı; nesne dizideki aynı yerde kalmalı.
   - Patch'te olmayan hiçbir nesneye dokunma.
   - Değişen nesnelerin eski çeviri alanları (`explanation_en/uk`, `instructions_en/uk`, `i18n`) yeni nesnede olmayacak. Bu beklenen bir durum; 3. adımda yeniden eklenecek.
3. **Çevir:** Sadece değiştirilen nesneler için TASK-6'daki kurallar ve sözlükle `en` ve `uk` çevirilerini ekle.
   - Reading setleri: `instructions_*` ve her sorunun `explanation_*` alanları.
   - Kartlar: `i18n` alanı. Sprechen kartlarında `prompt` ve `sample` Almanca olduğu için çevrilmez; sadece Türkçe blok başlıkları ve satırlar çevrilir.
4. **Doğrula:** `tools/check-i18n.mjs`'i çalıştır. Script'e kısa bir ayar ekle: patch'teki ID'lerin `answer` ve `options` karşılaştırması yeni patch'e göre yapılsın, eski dosyaya göre değil. Diğer bütün nesneler için eski kontroller aynen geçerli.
5. **Eski sonuçları temizle:** Uygulama açılışında, localStorage'daki `b2trainer:reading` kaydında aşağıdaki set ID'lerine ait en iyi skorları ve yanlış listelerini bir kez sil. Bu setlerin soruları değişti. Bu temizliğin iki kez çalışmaması için bir `migrated_2_2` bayrağı kullan.
   `L1-8, L1-9, L2-8, L2-9, L2-10, L2-11, L3-7, L3-8, L3-9, L3-10, L4-7, L4-8, L4-9, LS1-4`
6. `meta.version` değerini `"2.2"` yap. Uygulama sürümünü artır, `patch-v2.2.json`'u repodan sil, push et.

## Kontrol (telefonda, 5 dakika)
- **Kartlar › Sprechen › Teil 1** temalarının görev cümleleri değişmiş olmalı.
- **Teil 2 örneği:** Mittagspause ve Weihnachtsfeier kartları.
- **Teil 3 örneği:** Blumengeschäft senaryosu.
- **Lesen › L2-8:** "Betriebsarzt & Zeitkonto" başlığı görünmeli.
- **L4-9:** "Stadtbibliothek" başlığı görünmeli.
- Dil İngilizce ve Ukraynaca yapılınca bu yeni içeriklerin açıklamaları da o dilde gelmeli.
