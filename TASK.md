# Görev: DTB B2 Prüfungstrainer (PWA)

Eşimin 6 gün sonra "Deutsch-Test für den Beruf B2" sınavı var. Telefonda (iPhone, Safari → Ana Ekrana Ekle) kullanacağı bir çalışma uygulaması yap. **Hız öncelikli: önce çalışan en basit sürüm, sonra iyileştirme.**

## Konum
Bu repo (`b2-trainer`) kökünde çalış. GitHub Pages: main branch, root. Yayın adresi: `https://mugiatama34.github.io/b2-trainer/`

## Teknik kısıtlar
- Sadece statik dosyalar: `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, `b2-data.json`, ikon(lar). Framework yok, build adımı yok, backend/API anahtarı yok.
- Tüm yollar **relative** olsun (`./b2-data.json`), çünkü site `/b2-trainer/` alt yolunda yayınlanıyor.
- İçerik repodaki `b2-data.json` dosyasından `fetch` ile yüklenir. Şemayı dosyadan oku; **dosyayı değiştirme**.
- İlerleme `localStorage`'da. **Tüm anahtarlar `b2trainer:` önekiyle başlasın** (aynı github.io origin'inde wortkasten uygulaması da var, çakışmasın).
- Service worker: uygulama dosyalarını ve JSON'u önbelleğe alsın, çevrimdışı çalışsın. JSON için network-first (güncellemeler hemen gelsin), diğerleri cache-first. Cache adında sürüm numarası olsun.
- Mobil öncelikli, büyük dokunma alanları, açık/koyu tema (`prefers-color-scheme`). Arayüz dili Türkçe, içerik Almanca.

## JSON şeması (özet)
- `sections[]`: `id`, `name`
- `questions[]`: `id`, `section`, `type:"mc"`, `topic`, `prompt` (boşluk `___`), `options[]`, `answer` (doğru seçeneğin indeksi), `explanation_tr`, `tags[]`
  - **Not:** Dosyada doğru cevap hep indeks 0. Seçenekleri gösterirken **her seferinde karıştır**.
- `cards[]`: `id`, `deck` (`pruefung` | `schreiben` | `sprechen`), `title`, `prompt`, `blocks[]` (`heading`, `lines[]`), opsiyonel `sample` (uzun metin, `\n` satır sonu), opsiyonel `examiner_questions[]`, `tags[]`

## Ekranlar
1. **Ana sayfa**: bugünkü tekrar sayısı ("X soru tekrar bekliyor"), butonlar: Pratik · Sınav modu · Tekrar · Kartlar · İlerleme.
2. **Pratik**: bölüm seç (sections) ve opsiyonel konu (`topic`) filtresi → 10'luk tur. Cevaplayınca anında doğru/yanlış rengi + `explanation_tr` göster, "Devam" butonu.
3. **Sınav modu**: tüm bölümlerden karışık 20 soru, üstte geri sayım (varsayılan 12 dk, ayarlanabilir). Sırasında açıklama yok; sonunda skor + yanlışların listesi açıklamalarıyla.
4. **Tekrar (basit aralıklı tekrar, Leitner)**:
   - Her soru için `box` (0–4) ve `due` (tarih) sakla.
   - Yanlış → box 0, due = şimdi (aynı oturumda tur sonunda tekrar sor).
   - Doğru → box+1; aralıklar: box1 = 1 gün, box2 = 2 gün, box3 = 4 gün, box4 = 7 gün.
   - Tekrar ekranı: due olanlar, önce düşük box.
5. **Kartlar**: deck sekmeleri (Prüfung / Schreiben / Sprechen). Liste → karta dokun → detay: `prompt`, blok başlıkları + satırlar, "Mustertext göster" (sample katlanabilir), `examiner_questions` varsa ayrı bölüm.
   - Sample metinlerdeki `[köşeli parantez]` kısımlarını vurgula (kişisel bilgiyle doldurulacak yerler).
   - Sprechen kartlarında **2 dakikalık konuşma zamanlayıcısı** (başlat/durdur).
   - Sample metin için **"Vorlesen"** butonu: `speechSynthesis`, `lang = "de-DE"`, hız 0.9. Durdur butonu da olsun.
   - Karta "öğrendim" işareti (localStorage) — listede tik görünsün.
6. **İlerleme**: bölüm başına ve `topic` başına doğru yüzdesi (bar), toplam çözülen soru, en zayıf 3 konu. "İlerlemeyi sıfırla" (onaylı).

## PWA
- `manifest.json`: `name: "B2 Prüfungstrainer"`, `short_name: "B2 Beruf"`, `display: "standalone"`, `start_url: "./"`, `scope: "./"`, tema rengi, 192/512 ikon (basit harf ikonu yeterli).
- iOS için `<link rel="apple-touch-icon">` ve `apple-mobile-web-app-capable` meta etiketleri.

## Teslim sırası
1. Pratik + Kartlar + localStorage ile çalışan ilk sürüm → commit/push.
2. Tekrar + Sınav modu + İlerleme → commit/push.
3. PWA (manifest, SW, ikon) → commit/push.
Her adım sonunda `README.md`'ye 3 satır: ne eklendi, nasıl test edilir.

## Kabul kriterleri
- iPhone Safari'de açılıyor, ana ekrana eklenince tam ekran açılıyor.
- Uçak modunda (bir kez açıldıktan sonra) çalışıyor.
- Uygulamayı kapatıp açınca ilerleme ve tekrar kutuları duruyor.
- JSON'a yeni soru/kart eklenince kod değişmeden görünüyor.
