// KONFIGURACJA SUPABASE
const SUPABASE_URL = "https://vuhnrmnwkjlxcrysmvkx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1aG5ybW53a2pseGNyeXNtdmt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTg1OTgsImV4cCI6MjEwMTc3NDU5OH0.ZDO7tNWNRVimRzXsn-_lZvkr0y7aUy88KlR57rgAkts";

// KONFIGURACJA BACKENDU
const BACKEND_URL = "http://127.0.0.1:3000";

// === WALIDACJA EVENT TOKEN ===

// Pobranie tokenu z URL
const params = new URLSearchParams(window.location.search);
const EVENT_TOKEN = params.get("event_token");
console.log("Pobrano token z URL:", EVENT_TOKEN);

// Walidacja formatu (64 znaki hex = 256 bitów)
const validHex = /^[a-f0-9]{64}$/i;

// Ukrycie strony do czasu walidacji
//document.body.style.display = "none";

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
        //zaloguj wysłanie żądania
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

// ELEMENTY UI
const fileInput = document.getElementById("fileInput");
const fileInputLabel = document.getElementById("fileInputLabel");
const uploadBtn = document.getElementById("uploadBtn");
const selectedCount = document.getElementById("selectedCount");
const downloadSelectedBtn = document.getElementById("downloadSelectedBtn");

// ----------------------
// OBSŁUGA WYBORU PLIKÓW
// ----------------------
fileInput.addEventListener("change", () => {
  const count = fileInput.files.length;

  if (count > 0) {
    uploadBtn.style.display = "inline-block";
    selectedCount.textContent = `Wybrano ${count} zdjęć`;
  } else {
    uploadBtn.style.display = "none";
    selectedCount.textContent = "";
  }
});

// ----------------------
// POBIERANIE ZAZNACZONYCH
// ----------------------
function updateDownloadButton() {
  const checked = document.querySelectorAll('.photo-controls input[type="checkbox"]:checked');
  downloadSelectedBtn.style.display = checked.length > 0 ? "block" : "none";
}

downloadSelectedBtn.addEventListener("click", async () => {
  const checked = document.querySelectorAll('.photo-controls input[type="checkbox"]:checked');

  for (const cb of checked) {
    const url = cb.dataset.url;

    const response = await fetch(url);
    const blob = await response.blob();

    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = url.split("/").pop();
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

  uploadBtn.classList.add("loading");
  fileInputLabel.classList.add("disabled");

  for (const file of files) {
    const safeName = sanitizeFileName(file.name);
    const fileName = `${Date.now()}-${safeName}`;

    const { error } = await client.storage
      .from("Photos")
      .upload(fileName, file);

    if (error) {
      console.error("Błąd uploadu:", error);
      alert("Błąd podczas wysyłania zdjęcia.");
      break;
    }
  }

  uploadBtn.classList.remove("loading");
  fileInputLabel.classList.remove("disabled");

  fileInput.value = "";
  uploadBtn.style.display = "none";
  selectedCount.textContent = "";

  document.querySelectorAll('.photo-controls input[type="checkbox"]').forEach(cb => cb.checked = false);
  downloadSelectedBtn.style.display = "none";

  loadGallery();
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
// ŁADOWANIE GALERII
// ----------------------
async function loadGallery() {
  const gallery = document.getElementById("gallery");

  const { data: files, error } = await client.storage
    .from("Photos")
    .list("", { limit: 200 });

  if (error) {
    console.error("Błąd pobierania listy plików:", error);
    return;
  }

  const sorted = files
    .filter(f => f.metadata?.size > 0)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  gallery.innerHTML = "";

  for (const file of sorted) {
    const { data: urlData } = client.storage
      .from("Photos")
      .getPublicUrl(file.name);

    const frame = document.createElement("div");
    frame.className = "photo-frame";

    const controls = document.createElement("div");
    controls.className = "photo-controls";

    const controls1a = document.createElement("div");
    controls1a.className = "photo-controls-1a";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.url = urlData.publicUrl;
    checkbox.addEventListener("change", updateDownloadButton);

    const printBtn = document.createElement("button");
    printBtn.textContent = "Drukuj";
    printBtn.disabled = true;

    controls1a.appendChild(checkbox);
    controls.appendChild(controls1a);

    const label = document.createElement("label");
    label.className = "photo-controls-1a .label";
    label.textContent = "Zaznacz, aby pobrać";
    controls1a.appendChild(label);
    controls.appendChild(printBtn);

    checkPrinterAvailability().then((available) => {
      if (available) {
        printBtn.disabled = false;
        printBtn.style.cursor = "pointer";
        printBtn.style.background = "#222";
        printBtn.style.color = "#fff";
      } else {
        printBtn.disabled = true;
        printBtn.style.cursor = "not-allowed";
        printBtn.style.background = "#ccc";
        printBtn.style.color = "#666";
      }
    });

    printBtn.addEventListener("click", async () => {
  const available = await checkPrinterAvailability();

  if (!available) {
    alert("Backend drukarki jest offline");
    return;
  }

  // 🔥 LOADER W PRZYCISKU
  const originalText = printBtn.textContent;
  printBtn.textContent = "⏳";
  printBtn.disabled = true;

  try {
    const response = await fetch(`${BACKEND_URL}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: urlData.publicUrl,
        event_token: EVENT_TOKEN
      })
    });

    if (response.status === 429) {
      alert("Za szybko! Poczekaj chwilę przed kolejnym drukowaniem.");
    } else if (response.status === 409) {
      // 🔥 DUPLIKAT W KOLEJCE
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

    } catch (err) {
      alert("Błąd połączenia z backendem");
    }

    // 🔥 PRZYWRÓCENIE PRZYCISKU
    printBtn.textContent = originalText;
    printBtn.disabled = false;
  });


    const link = document.createElement("a");
    link.href = urlData.publicUrl;
    link.className = "gallery-item";

    const img = document.createElement("img");
    img.src = urlData.publicUrl;
    img.loading = "lazy";

    link.appendChild(img);

    frame.appendChild(controls);
    frame.appendChild(link);

    gallery.appendChild(frame);
  }

  if (galleryInstance) {
    galleryInstance.destroy(true);
  }

  galleryInstance = lightGallery(gallery, {
    selector: ".gallery-item",
    plugins: [lgZoom, lgThumbnail],
    speed: 300
  });
}

// Uruchom walidację przed ładowaniem galerii
validateEventToken().then(valid => {
  console.log("Wynik walidacji tokenu:", valid);
    if (valid) {
        loadGallery(); // ← Twoja istniejąca funkcja
    }
});