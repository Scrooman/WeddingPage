// KONFIGURACJA SUPABASE
const SUPABASE_URL = "https://vuhnrmnwkjlxcrysmvkx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1aG5ybW53a2pseGNyeXNtdmt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTg1OTgsImV4cCI6MjEwMTc3NDU5OH0.ZDO7tNWNRVimRzXsn-_lZvkr0y7aUy88KlR57rgAkts";

// KONFIGURACJA BACKENDU
const BACKEND_URL = "https://3659-194-9-78-248.ngrok-free.app";



// FUNKCJA SANITYZUJĄCA NAZWY PLIKÓW
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
  if (fileInput.files.length > 0) {
    uploadBtn.style.display = "inline-block";
  } else {
    uploadBtn.style.display = "none";
  }
});

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

// Logika pływającego przycisku pobierania


function updateDownloadButton() {
  const checked = document.querySelectorAll('.photo-controls input[type="checkbox"]:checked');
  downloadSelectedBtn.style.display = checked.length > 0 ? "block" : "none";
}

// Logika Pobierania wybranych zdjęć

downloadSelectedBtn.addEventListener("click", async () => {
  const checked = document.querySelectorAll('.photo-controls input[type="checkbox"]:checked');

  for (const cb of checked) {
    const url = cb.dataset.url;

    // Pobieramy plik jako blob
    const response = await fetch(url);
    const blob = await response.blob();

    // Tworzymy lokalny URL do pobrania
    const blobUrl = URL.createObjectURL(blob);

    // Tworzymy element <a> z atrybutem download
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = url.split("/").pop(); // nazwa pliku
    document.body.appendChild(a);

    // Wywołujemy pobranie
    a.click();

    // Sprzątanie
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  // Reset checkboxów
  checked.forEach(cb => cb.checked = false);

  // Ukrycie przycisku
  downloadSelectedBtn.style.display = "none";
});



// ----------------------
// UPLOAD ZDJĘĆ
// ----------------------
uploadBtn.addEventListener("click", async () => {
  const files = fileInput.files;

  if (!files.length) return;

  // UI: blokada + loader
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

  // UI: odblokowanie
  uploadBtn.classList.remove("loading");
  fileInputLabel.classList.remove("disabled");

  // Reset inputu
    fileInput.value = "";
    uploadBtn.style.display = "none";
    fileInput.value = "";
    uploadBtn.style.display = "none";
    selectedCount.textContent = "";

    document.querySelectorAll('.photo-controls input[type="checkbox"]').forEach(cb => cb.checked = false);
    downloadSelectedBtn.style.display = "none";

  // Odśwież galerię
  loadGallery();
});


//  ----------------------
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

  // Sortowanie po created_at DESC
  const sorted = files
    .filter(f => f.metadata?.size > 0) // pomijamy placeholder
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
    printBtn.disabled = true; // domyślnie wyłączony    

  controls1a.appendChild(checkbox);
  controls.appendChild(controls1a);

    // dodaj etykietę dla checkboxa
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
        console.warn("Drukowanie niedostępne — backend offline");
        return;
    }

    // Dodaj rekord do print_queue
    await client.from("print_queue").insert({
        image_url: urlData.publicUrl,
        status: "pending"
    });

    console.log("Zadanie drukowania wysłane");
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




loadGallery();