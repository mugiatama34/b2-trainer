# Görev 4: Coach süresi + veri güncellemesi

CLAUDE.md kuralları geçerli. Bu görevde sürümü bir kez artır.

## 1. Coach Teil 1 süresi: 3 dakika
- Coach Monolog modundaki (Teil 1A) zamanlayıcıyı 2 dk yerine **3 dk** yap.
- Ayarlar ekranına **"Monolog süresi"** seçimi ekle: 2 / 3 / 4 dk, varsayılan 3. Değer `b2trainer:settings` içinde saklansın. Coach ve Sprechen kartlarındaki zamanlayıcı bu değeri kullansın.
- Zamanlayıcıda **2:00'de kısa bir titreşim** (`navigator.vibrate(200)`, destek yoksa sessiz geç) ve ekranda "Sınavda burada durdurulabilirsin" notu göster. Süre bitince titreşim + görsel uyarı.
- `prompts.js` içinde `PROMPT_MONOLOG`'da iki satırı değiştir:
  - `roughly 2 minutes of content` → `about 2–3 minutes of content (in the exam the examiner may stop her after 2 minutes, so all task points should be covered early)`
  - `180-230 words` → `230-300 words`

## 2. Yeni b2-data.json (v1.3)
- Repodaki `b2-data.json` dosyasını yenisiyle değiştir. İçinde 9 yeni Lesen seti (toplam 18 set) ve yeni bir "Tuzak tipleri" kartı var.
- Şema aynı; kod değişikliği gerekmemeli. Lesen listesinde 18 setin ve Kartlar > Lesen'de yeni kartın göründüğünü kontrol et.

## Teslim
Tek push. README'ye kısa test notu ekle.
