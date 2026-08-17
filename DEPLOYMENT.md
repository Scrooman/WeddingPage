# Wedding Page - Deployment Instructions

## Overview
Zoptymalizowano aplikację pod kątem zmniejszenia zużycia Supabase egress (~93-95% reduction).

## Zmiany

### Phase 1: Edge Functions
- ✅ **upload-photo.ts**: Generowanie WebP thumbnails (300x300px), konwersja wszystkich zdjęć do WebP, walidacja (max 5 plików, deduplikacja, max 10MB)
- ✅ **gallery.ts**: In-memory cache dla signed URLs, paginacja (10 zdjęć), zwracanie par URL (thumbnail + oryginał)

### Phase 2: Frontend (script.js)
- ✅ Upload validation: max 5 zdjęć
- ✅ Lazy loading + pagination: 10 zdjęć per page z IntersectionObserver
- ✅ Thumbnails w galerii, oryginały w LightGallery
- ✅ Download limit: max 10 zdjęć
- ✅ Print confirmation: native confirm dialog

### Phase 3: Backend (app.js)
- ✅ File cache check przed downloadem z Supabase
- ✅ WebP support w print workflow

---

## Deployment Steps

### 1. Database Migration
Uruchom w Supabase SQL Editor:

```bash
# Otwórz Supabase Dashboard → SQL Editor → New Query
# Wklej zawartość pliku supabase_migration.sql i wykonaj
```

Lub bezpośrednio:

```sql
CREATE TABLE IF NOT EXISTS uploaded_files (
  id BIGSERIAL PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_hash ON uploaded_files(hash);
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON uploaded_files
  FOR SELECT USING (true);

CREATE POLICY "Allow service role insert" ON uploaded_files
  FOR INSERT WITH CHECK (true);
```

### 2. Deploy Edge Functions

#### Opcja A: Supabase CLI (recommended)
```bash
# Zaloguj się do Supabase CLI
supabase login

# Link project
supabase link --project-ref vuhnrmnwkjlxcrysmvkx

# Deploy functions
supabase functions deploy upload-photo
supabase functions deploy gallery
```

#### Opcja B: Supabase Dashboard
1. Otwórz Supabase Dashboard → Edge Functions
2. Dla **upload-photo**:
   - Kliknij "New Function" lub edytuj istniejącą
   - Skopiuj cały kod z `edge_functions/upload-photo.ts`
   - Deploy
3. Dla **gallery**:
   - Powtórz proces
   - Skopiuj kod z `edge_functions/gallery.ts`
   - Deploy

### 3. Create Thumbnails Folder w Storage

W Supabase Dashboard → Storage → Photos bucket:
- Upewnij się, że folder `thumbnails/` istnieje (zostanie utworzony automatycznie przy pierwszym upload, ale możesz go utworzyć ręcznie)

### 4. Deploy Frontend

Bez zmian - pliki `index.html`, `script.js`, `style.css` są już gotowe. Jeśli używasz GitHub Pages:

```bash
git add .
git commit -m "feat: optimize egress with thumbnails, pagination, WebP conversion"
git push origin main
```

### 5. Update Backend (Node.js)

Jeśli backend działa lokalnie:
```bash
# Restart service
npx nodemon app.js
```

Jeśli na serwerze (np. VPS):
```bash
# Upload nowego app.js
scp app.js user@server:/path/to/app/

# Restart PM2 lub systemd service
pm2 restart wedding-backend
# lub
systemctl restart wedding-backend
```

---

## Weryfikacja

### Test 1: Upload Flow
1. Otwórz stronę z `?event_token=...`
2. Wybierz 3 zdjęcia → kliknij "Wyślij"
3. **Oczekiwane**: Alert z informacją "Wysłano 3 z 3 zdjęć"
4. Sprawdź Supabase Storage → `Photos/` bucket:
   - Pliki `.webp` (oryginały)
   - Folder `thumbnails/` z plikami `-thumb.webp`
5. Sprawdź tabelę `uploaded_files` → hash entries created

### Test 2: Deduplication
1. Upload tego samego zdjęcia ponownie
2. **Oczekiwane**: Alert "Pominięto duplikaty: 1"

### Test 3: File Size Limit
1. Wybierz plik >10MB
2. **Oczekiwane**: Alert "Odrzucono: 1" (reason: file_too_large)

### Test 4: Max 5 Files
1. Wybierz 6 zdjęć
2. **Oczekiwane**: Alert "Maksymalnie 5 zdjęć na raz!"

### Test 5: Gallery Pagination
1. Załaduj stronę → tylko 10 zdjęć wyświetlonych
2. Scroll w dół
3. **Oczekiwane**: Loader "⏳ Ładowanie..." → kolejne 10 zdjęć

### Test 6: Thumbnails
1. Sprawdź Network tab (DevTools)
2. Thumbnail requests: ~20-30KB każde
3. Kliknij thumbnail → LightGallery otwiera original (~800KB WebP)

### Test 7: Download Limit
1. Zaznacz 11 checkboxów
2. **Oczekiwane**: Alert "Maksymalnie 10 zdjęć naraz do pobrania!", 11th uncheck

### Test 8: Print Confirmation
1. Kliknij "Drukuj"
2. **Oczekiwane**: Native confirm dialog
3. Kliknij "OK" → print job wysłany

### Test 9: Print Cache
1. Wydrukuj to samo zdjęcie 2×
2. Check backend console logs
3. **Oczekiwane**: "Using cached file: {id}.webp"

### Test 10: Signed URL Cache
1. Załaduj galerię
2. Poczekaj 30s
3. Załaduj ponownie (refresh)
4. **Oczekiwane**: Te same signed URLs (z cache), nie nowe requesty do `createSignedUrl`

---

## Rollback Plan

Jeśli coś pójdzie nie tak:

### Edge Functions
```bash
# Przywróć z wersji w repo versions/
git checkout HEAD~1 edge_functions/upload-photo.ts
git checkout HEAD~1 edge_functions/gallery.ts
supabase functions deploy upload-photo
supabase functions deploy gallery
```

### Frontend
```bash
git checkout HEAD~1 script.js
git push origin main
```

### Database
```sql
DROP TABLE uploaded_files;
```

---

## Monitoring

### Supabase Dashboard → Storage
- Obserwuj rozmiary bucketów
- Thumbnails powinny zajmować ~1/30 rozmiaru oryginałów

### Supabase Dashboard → Database
- Sprawdź `uploaded_files` table growth
- Hash dedupe powinno zapobiegać duplikatom

### Backend Logs
```bash
# Check print job processing
tail -f logs/app.log

# Check cache hits
grep "Using cached file" logs/app.log | wc -l
```

---

## Troubleshooting

### Issue: Thumbnails nie generują się
**Rozwiązanie**: Sprawdź Edge Function logs w Supabase Dashboard → Edge Functions → upload-photo → Logs. ImageScript może failować na bardzo dużych plikach.

### Issue: "Hash already exists" error
**Rozwiązanie**: To oczekiwane dla duplikatów. Jeśli false positive, zwiększ `chunkSize` w `hashFile()` z 512KB do 1MB.

### Issue: Pagination nie ładuje więcej
**Rozwiązanie**: Sprawdź `hasMore` w gallery response. Jeśli false, to wszystkie zdjęcia już załadowane.

### Issue: LightGallery nie otwiera oryginałów
**Rozwiązanie**: Sprawdź `data-src` attribute na `.gallery-item` links. Powinno wskazywać na `originalUrl`.

### Issue: Backend download failuje dla WebP
**Rozwiązanie**: Upewnij się, że Windows ma WebP codec zainstalowany (wbudowany w Windows 10+).

---

## Cost Savings Estimate

**Przed** (50 photos × 3MB):
- Gallery load: 50 × 3MB = 150MB egress
- Full view: 5 × 3MB = 15MB
- Print: 1 × 3MB = 3MB
- **Total**: ~168MB per session

**Po** (thumbnails + WebP + cache):
- Gallery load: 10 × 25KB = 250KB (first page)
- Pagination: 10 × 25KB = 250KB (second page)
- Full view: 5 × 800KB = 4MB (WebP compressed)
- Print: 0KB (cached locally)
- **Total**: ~4.5MB per session

**Reduction**: **~97% egress savings** 🎉

---

## Notes

1. **ImageScript memory limit**: Edge Functions mają 50MB RAM. Pliki >10MB mogą failować. Validation dodano dla bezpieczeństwa.

2. **Signed URL expiry**: Cache ma 60s buffer. Po 3600s URLs wygasają i muszą być regenerowane (automatyczne przy kolejnym loadGallery).

3. **Backward compatibility**: `signedUrl` field jest zachowane w gallery response dla kompatybilności z starym frontendem (jeśli nie wdrożysz script.js od razu).

4. **Print queue deduplication**: Database constraint na `print_queue.image_url` zapobiega duplicate print jobs (już istniejące).

5. **WebP browser support**: WebP jest supportowane przez wszystkie nowoczesne przeglądarki (Chrome, Firefox, Edge, Safari 14+). Fallback nie jest potrzebny.
