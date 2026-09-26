# Görev 3: Lesen (okuduğunu anlama) modülü

`b2-data.json` v1.2 ile değişti: yeni `reading` ve `reading_parts` alanları geldi, `cards` içine de `deck: "lesen"` strateji kartları eklendi. Repodaki JSON'u bununla değiştir. CLAUDE.md kuralları geçerli; sürümü artırmayı unutma (bu değişiklik 1.x → bir üst minor).

## JSON şeması (yeni kısım)
- `reading_parts[]`: `id`, `name`. Parçalar: lesen1, lesen2, lesen3, lesen4, lesen-schreiben1.
- `reading[]` (her biri bir alıştırma seti):
  - `id`, `part`, `title`, `instructions_tr`, opsiyonel `context_de`
  - `layout`: `"matching"` veya `"text-questions"`
  - `allow_none`: true ise eşleştirmede ek bir **"x" (kein Tipp)** seçeneği gösterilir
  - `texts[]`: `key` (a–h, T1, T2, P, M…), `title` (boş olabilir), `body` (`\n` = paragraf)
  - `questions[]`: `id`, `num` (sınavdaki soru numarası), `kind`, `prompt`, `answer`, `explanation_tr`
    - `kind:"match"` → `answer` bir text `key`'i ya da `"x"`
    - `kind:"rf"` veya `kind:"mc"` → `options[]`, `answer` = indeks, `text_ref` = ilgili metnin key'i
  - **Seçenekleri karıştırma.** Sınavda a/b/c sırası sabit olduğu için burada karıştırma yok.

## Ekran: "Lesen"
Ana sayfaya **Lesen** butonu ekle.
1. **Liste**: `reading_parts` gruplarına göre setler listelenir. Her setin yanında en iyi skoru görünür (ör. 4/5).
2. **Set ekranı**:
   - Üstte `instructions_tr` (küçük, gri) ve `context_de` gösterilir.
   - **matching**:
     - Metinler katlanabilir kartlar olarak gösterilir (başlık + key rozeti).
     - Altında her soru için bir satır: `num` + `prompt` + key butonları (a b c …, `allow_none` ise x).
   - **text-questions**:
     - Metin üstte, kaydırılabilir. Birden fazla metin varsa sekmeler olsun.
     - Sorular altta; `text_ref` değişince ilgili sekme otomatik açılsın.
     - `rf` sorusu iki buton olarak (richtig/falsch), `mc` sorusu a/b/c olarak gösterilir.
   - Sayfanın altında sabit bir **"Kontrol et"** butonu olsun. O basana kadar cevap gösterilmez (sınav gibi).
   - Kontrol sonrası: her soru yeşil/kırmızı işaretlenir, `explanation_tr` açılır, doğru cevap gösterilir.
   - İsteğe bağlı **zamanlayıcı** (varsayılan kapalı; açılınca matching setlerinde 10 dk, diğerlerinde 12 dk).
3. **Kayıt** (`b2trainer:reading`): set başına en iyi skor, son skor ve son yanlış soru id'leri.
4. **İlerleme ekranı**: her `reading_parts` için doğru yüzdesi eklenir.
5. **Kartlar**: `lesen` deck'i otomatik bir sekme olarak görünmeli. Kod genelse bu zaten çalışıyor olmalı, kontrol et.

## Mobil detaylar
- Uzun metinlerde okunabilirlik önemli: satır yüksekliği 1.6, font 17px, paragraflar arası boşluk.
- Metinde uzun basınca kelimeyi vurgulama (highlight) özelliği güzel olur ama **opsiyonel**, en sona bırak.

## Teslim
Tek adım: Lesen ekranı + ilerleme entegrasyonu → sürüm artır → push. README'ye test notu ekle.
