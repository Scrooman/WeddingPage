// KONFIGURACJA SUPABASE
const SUPABASE_URL = "https://vuhnrmnwkjlxcrysmvkx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1aG5ybW53a2pseGNyeXNtdmt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTg1OTgsImV4cCI6MjEwMTc3NDU5OH0.ZDO7tNWNRVimRzXsn-_lZvkr0y7aUy88KlR57rgAkts";

// KONFIGURACJA BACKENDU
const BACKEND_URL = "https://implied-christmas-disks-pig.trycloudflare.com";

// === WALIDACJA EVENT TOKEN ===

// Pobranie tokenu z URL
const params = new URLSearchParams(window.location.search);
const EVENT_TOKEN = params.get("event_token");
console.log("Pobrano token z URL:", EVENT_TOKEN);

// Walidacja formatu (64 znaki hex = 256 bitów)
const validHex = /^[a-f0-9]{64}$/i;

async function validateEventToken() {
    if (!EVENT_TOKEN || !validHex.test(EVENT_TOKEN)) {
        showAccessDenied("Brak lub niepoprawny token w adresie URL");
        return false;
    }

    // Zapytanie do Supabase
    const { data, error } = await client
        .from("event_tokens")
        .select("*")
        .eq("token", EVENT_TOKEN)
        .single();
    
    console.log("Wysłano żądanie walidacji tokenu:", EVENT_TOKEN);

    if (error || !data) {
        showAccessDenied("Token nie istnieje w bazie");
        return false;
    }

    if (data.active === false) {
        showAccessDenied("Token jest nieaktywny");
        return false;
    }

    // Token poprawny → pokazujemy stronę
    document.body.style.display = "block";
    return true;
}

function showAccessDenied(msg) {
    document.body.innerHTML = `
        <div style="padding:40px; text-align:center; font-family:Inter;">
            <h2>Brak dostępu</h2>
            <p>${msg}</p>
        </div>
    `;
}

function sanitizeFileName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

console.log("Supabase URL:", SUPABASE_URL);
console.log("Backend URL:", BACKEND_URL);

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let galleryInstance = null;
let galleryObserver = null;

// ELEMENTY UI
const fileInput = document.getElementById("fileInput");
const fileInputLabel = document.getElementById("fileInputLabel");
const uploadBtn = document.getElementById("uploadBtn");
const selectedCount = document.getElementById("selectedCount");
const downloadSelectedBtn = document.getElementById("downloadSelectedBtn");

// Pagination state
let currentOffset = 0;
let isLoadingMore = false;
let hasMorePhotos = true;

// ----------------------
// OBSŁUGA WYBORU PLIKÓW
// ----------------------
fileInput.addEventListener("change", async () => {
  const count = fileInput.files.length;

  fileInputLabel.classList.add("disabled");

  // odczekanie 1 sekundy przed pokazaniem przycisku upload
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (count > 0) {
    // Walidacja: max 5 zdjęć
    if (count > 5) {
      alert("Maksymalnie 5 zdjęć na raz!");
      fileInput.value = "";
      fileInputLabel.classList.remove("disabled");
      return;
    }

    fileInputLabel.classList.remove("disabled");
    uploadBtn.style.display = "inline-block";
    uploadBtn.textContent = `Wyślij ➤`;

    selectedCount.textContent = `Wybrano ${count} zdjęć`;
    selectedCount.classList.remove("hidden");
    selectedCount.classList.add("show");

    fileInputLabel.classList.add("active");
  } else {
    uploadBtn.style.display = "none";
    selectedCount.classList.remove("show");
    selectedCount.classList.add("hidden");
    selectedCount.textContent = "";
  }
});

// ----------------------
// POBIERANIE ZAZNACZONYCH
// ----------------------
function updateDownloadButton() {
  const checked = document.querySelectorAll('.photo-controls input[type="checkbox"]:checked');
  
  // Limit do 10 zdjęć
  if (checked.length > 10) {
    alert("Maksymalnie 10 zdjęć naraz do pobrania!");
    checked[checked.length - 1].checked = false;
    return;
  }
  
  downloadSelectedBtn.style.display = checked.length > 0 ? "block" : "none";
}

function getDownloadFileName(url) {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").pop() || "download";
    return sanitizeFileName(decodeURIComponent(name));
  } catch {
    const fallback = String(url).split("?")[0].split("/").pop() || "download";
    return sanitizeFileName(fallback);
  }
}

downloadSelectedBtn.addEventListener("click", async () => {
  const checked = document.querySelectorAll('.photo-controls input[type="checkbox"]:checked');

  for (const cb of checked) {
    const url = cb.dataset.url;
    const fileName = getDownloadFileName(url);

    const response = await fetch(url);
    const blob = await response.blob();

    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(blobUrl);
  }

  checked.forEach(cb => cb.checked = false);
  downloadSelectedBtn.style.display = "none";
});

// ----------------------
// UPLOAD ZDJĘĆ
// ----------------------
uploadBtn.addEventListener("click", async () => {
  const files = fileInput.files;
  if (!files.length) return;

  if (files.length > 5) {
    alert("Maksymalnie 5 zdjęć na raz!");
    return;
  }

  uploadBtn.classList.add("loading");
  uploadBtn.textContent = "";
  fileInputLabel.classList.add("disabled");

  try {
    const formData = new FormData();
    formData.append("event_token", EVENT_TOKEN);
    
    for (let i = 0; i < files.length; i++) {
      const safeName = sanitizeFileName(files[i].name);
      formData.append("file", files[i], safeName);
    }

    const { data, error } = await client.functions.invoke("upload-photo", {
      body: formData
    });

    if (error) {
      console.error("Upload error:", error);
      alert(`Błąd uploadu: ${error.message || "unknown"}`);
    } else {
      let message = data.message || `Wysłano ${data.uploaded?.length || 0} zdjęć`;
      
      if (data.duplicates && data.duplicates.length > 0) {
        message += `\n\nPominięto duplikaty: ${data.duplicates.length}`;
      }
      
      if (data.rejected && data.rejected.length > 0) {
        message += `\n\nOdrzucono: ${data.rejected.length}`;
        console.log("Rejected files:", data.rejected);
      }
      
      alert(message);
    }
  } finally {
    uploadBtn.classList.remove("loading");
    fileInputLabel.classList.remove("disabled");
    fileInputLabel.classList.remove("active");
    fileInput.value = "";
    uploadBtn.style.display = "none";
    selectedCount.textContent = "";
    document.querySelectorAll('.photo-controls input[type="checkbox"]').forEach(cb => cb.checked = false);
    downloadSelectedBtn.style.display = "none";
    
    // Reset pagination i załaduj od początku
    await loadGallery(true);
  }
});

// ----------------------
// LOGIKA DRUKOWANIA
// ----------------------
async function checkPrinterAvailability() {
  try {
    const res = await fetch(`${BACKEND_URL}/status`);
    const data = await res.json();
    return data.online === true;
  } catch (err) {
    console.warn("Backend drukarki niedostępny");
    return false;
  }
}

// ----------------------
// LAZY LOADING (SENTINEL)
// ----------------------
function setupIntersectionObserver() {
  const gallery = document.getElementById("gallery");
  
  let sentinel = document.getElementById("scroll-sentinel");
  if (sentinel) sentinel.remove();

  if (!hasMorePhotos) return;

  sentinel = document.createElement("div");
  sentinel.id = "scroll-sentinel";
  sentinel.style.cssText = "height: 20px; width: 100%; margin-top: 10px;";
  gallery.appendChild(sentinel);

  if (galleryObserver) {
    galleryObserver.disconnect();
  }

  galleryObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !isLoadingMore && hasMorePhotos) {
      loadGallery(false);
    }
  }, {
    rootMargin: "10px",
    threshold: 0.1
  });

  galleryObserver.observe(sentinel);
}

// ----------------------
// ŁADOWANIE GALERII
// ----------------------
async function loadGallery(reset = false) {
  const gallery = document.getElementById("gallery");

  if (reset) {
    gallery.innerHTML = "";
    currentOffset = 0;
    hasMorePhotos = true;
    if (galleryObserver) galleryObserver.disconnect();
  }

  if (isLoadingMore || !hasMorePhotos) return;

  isLoadingMore = true;

  // Usuń istniejący sentinel na czas ładowania
  const oldSentinel = document.getElementById("scroll-sentinel");
  if (oldSentinel) oldSentinel.remove();

  // Pokaż loader
  const loader = document.createElement("div");
  loader.id = "gallery-loader";
  loader.style.cssText = "text-align:center; padding:20px; font-size:24px; width: 100%;";
  loader.textContent = "⏳ Ładowanie...";
  gallery.appendChild(loader);

  const { data, error } = await client.functions.invoke("gallery", {
    body: {
      event_token: EVENT_TOKEN,
      expiresIn: 3600, // 
      limit: 5,
      offset: currentOffset
    }
  });

  // Usuń loader
  const loaderEl = document.getElementById("gallery-loader");
  if (loaderEl) loaderEl.remove();

  if (error) {
    console.error("Gallery error:", error);
    if (reset) {
      gallery.innerHTML = "<p>Błąd pobierania galerii</p>";
    }
    isLoadingMore = false;
    return;
  }

  const files = data?.files || [];
  console.log('Images:', files);
  
  hasMorePhotos = data?.hasMore || false;
  currentOffset += files.length;

  for (const file of files) {
    if (!file.signedUrl) continue;

    const frame = document.createElement("div");
    frame.className = "photo-frame";

    const controls = document.createElement("div");
    controls.className = "photo-controls";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.url = file.signedUrl;
    checkbox.addEventListener("change", updateDownloadButton);

    const label = document.createElement("label");
    label.className = "photo-controls-1a";
    label.textContent = "Zaznacz, aby pobrać";

    const printBtn = document.createElement("button");
    printBtn.textContent = "Drukuj";
    printBtn.disabled = true;

    const controls1a = document.createElement("div");
    controls1a.className = "photo-controls-1a";
    controls1a.appendChild(checkbox);
    controls1a.appendChild(label);

    controls.appendChild(controls1a);
    controls.appendChild(printBtn);

    const link = document.createElement("a");
    link.href = file.originalUrl || file.signedUrl;
    link.className = "gallery-item";
    link.dataset.src = file.originalUrl || file.signedUrl;

    const img = document.createElement("img");
    img.src = file.thumbnailUrl || file.signedUrl;
    img.dataset.original = file.originalUrl || file.signedUrl;

    link.appendChild(img);
    frame.appendChild(controls);
    frame.appendChild(link);
    gallery.appendChild(frame);

    checkPrinterAvailability().then((available) => {
      if (available) {
        printBtn.disabled = false;
        printBtn.style.cursor = "pointer";
      }
    });

    printBtn.addEventListener("click", async () => {
      if (!confirm("Czy na pewno chcesz wydrukować to zdjęcie?")) {
        return;
      }

      const available = await checkPrinterAvailability();
      if (!available) {
        alert("Backend drukarki jest offline");
        printBtn.disabled = true;
        return;
      }

      const originalText = printBtn.textContent;
      printBtn.textContent = "⏳";
      printBtn.disabled = true;

      try {
        const response = await fetch(`${BACKEND_URL}/print`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: file.signedUrl,
            event_token: EVENT_TOKEN
          })
        });

        if (response.status === 429) {
          alert("Za szybko! Poczekaj chwilę przed kolejnym drukowaniem.");
        } else if (response.status === 409) {
          alert("To zdjęcie jest już w kolejce do druku");
        } else if (response.status === 400) {
          alert("Nieprawidłowy URL obrazu");
        } else if (response.status === 422) {
          alert("To zdjęcie jest już w trakcie drukowania");
        } else if (!response.ok) {
          alert("Nie udało się wysłać zadania drukowania");
        } else {
          alert("Zadanie drukowania wysłane");
        }

        printBtn.classList.remove("active");
      } catch (err) {
        alert("Błąd połączenia z backendem");
      }

      printBtn.textContent = originalText;
      printBtn.disabled = false;
    });
  }

  isLoadingMore = false;

  // Reinicjalizacja LightGallery
  if (reset) {
    if (galleryInstance) {
      galleryInstance.destroy(true);
    }
    galleryInstance = lightGallery(gallery, {
      selector: ".gallery-item",
      plugins: [lgZoom, lgThumbnail],
      speed: 300
    });
  } else if (galleryInstance) {
    galleryInstance.refresh();
  }

  // Konfiguracja obserwatora doładowywania kolejnych stron
  setupIntersectionObserver();
}

// Uruchomienie aplikacji po walidacji tokenu
validateEventToken().then(valid => {
  console.log("Wynik walidacji tokenu:", valid);
  if (valid) {
    loadGallery(true);
  }
});