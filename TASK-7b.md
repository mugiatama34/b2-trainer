# Görev 7b: Küçük düzeltmeler + yasal uyarı

**Ön koşul:** TASK-7 tamamen bitmiş ve push edilmiş olmalı. Bu görev yeni bir patch dosyası kullanmıyor; sadece **alan bazında küçük değişiklikler** yapıyor. Böylece mevcut çevirilere dokunulmuyor.
CLAUDE.md kuralları geçerli.

## 1. `b2-data.json` alan düzeltmeleri (sadece bu 5 yer)

1. `questions` → `id: "sprachbausteine2-030"` → `prompt` alanının yeni değeri:
   `Wenn die Ware auch künftig pünktlich und fehlerfrei ankommt, dürfen Sie mit weiteren Bestellungen ___.`
   (`options`, `answer` ve açıklamalar aynı kalır.)

2. `reading` → `id: "L1-1"` → `context_de` alanının yeni değeri:
   `Sie stöbern im Karriereteil einer Online-Zeitung und wollen Bekannten passende Beiträge weiterleiten.`

3. `cards` → `id: "sprechen-t1-2"` → `sample` alanında şu cümleyi değiştir:
   - Eski: `Ich spreche heute darüber, wie ich mir ein gutes Arbeitsumfeld vorstelle.`
   - Yeni: `Heute erzähle ich, was für mich einen guten Arbeitsplatz ausmacht.`

4. `cards` → `id: "schreiben-ablehnen"` → Almanca satırı değiştir:
   - Eski: `Dennoch möchten wir Ihnen entgegenkommen und bieten Ihnen … an.`
   - Yeni: `Trotzdem kommen wir Ihnen gern entgegen und bieten Ihnen … an.`
   - Bu satır ana `blocks` alanında **ve** `i18n.en.blocks` ile `i18n.uk.blocks` içinde de geçiyor. Hepsinde aynı şekilde değiştir.

5. `cards` → `id: "schreiben-notiz-themen"` → İsim örneğindeki harf dizisini değiştir:
   - Eski: `S-T-Ä-D-T-L-E-R`
   - Yeni: `K-Ö-H-L-E-R`
   - Bu da ana `blocks` alanında ve `i18n.en` / `i18n.uk` içinde geçiyor. Hepsinde değiştir.

Değişikliklerden sonra `tools/check-i18n.mjs` temiz geçmeli. `meta.version` → `"2.3"`.

## 2. Yasal uyarı (disclaimer)
- İlk açılışta, dil seçiminden hemen sonra bir kez gösterilen bir bilgi ekranı ekle. "Anladım" butonu olsun; onay `b2trainer:disclaimerAccepted` anahtarında saklansın.
- Ayarlar'a bir **"Hakkında"** bölümü ekle; aynı metin orada her zaman okunabilsin.
- Metin 4 dilde olsun (`ui.*.json`):
  - **DE:** „Dieses Übungsprogramm ist ein unabhängiges, privates Projekt. Es steht in keiner Verbindung zur telc gGmbH oder zum Bundesamt für Migration und Flüchtlinge (BAMF) und ist kein offizielles Prüfungsmaterial. Alle Übungen wurden eigenständig erstellt und orientieren sich nur am Format der Prüfung. Einige Inhalte wurden mit Hilfe von KI erstellt und können Fehler enthalten.“
  - **TR:** „Bu çalışma programı bağımsız, özel bir projedir. telc gGmbH veya Federal Göç ve Mülteci Dairesi (BAMF) ile hiçbir bağlantısı yoktur ve resmî sınav materyali değildir. Tüm alıştırmalar özgün olarak hazırlanmıştır, yalnızca sınavın formatını örnek alır. Bazı içerikler yapay zekâ yardımıyla üretilmiştir ve hata içerebilir.“
  - **EN** ve **UK:** Aynı anlamda çevir.
- Ana sayfanın en altına küçük gri bir satır ekle: „Unabhängiges Übungsprojekt – kein offizielles telc-/BAMF-Material“. Satır seçili dile göre değişsin.

## 3. Kaynak belgesi
Repo köküne `CONTENT_SOURCES.md` ekle. İçeriği:
> Tüm soru, metin ve kartlar bu proje için özgün olarak üretilmiştir (yapay zekâ desteğiyle, 2026). Resmî materyallerden yalnızca sınavın genel formatı ve görev tipleri örnek alınmıştır; metin kopyalanmamıştır. 30.09.2026'da tüm Almanca içerik, eldeki resmî ve yayınlanmış alıştırma materyalleriyle 7 kelimelik dizi bazında karşılaştırılmış; yalnızca yaygın kalıp ifadelerde eşleşme bulunmuş ve bunlar da yeniden yazılmıştır.

## Teslim
Tek commit. Uygulama sürümünü artır ve push et.
