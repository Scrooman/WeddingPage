// KONFIGURACJA SUPABASE
const SUPABASE_URL = "https://vuhnrmnwkjlxcrysmvkx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1aG5ybW53a2pseGNyeXNtdmt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTg1OTgsImV4cCI6MjEwMTc3NDU5OH0.ZDO7tNWNRVimRzXsn-_lZvkr0y7aUy88KlR57rgAkts";

// FUNKCJA SANITYZUJĄCA NAZWY PLIKÓW
function sanitizeFileName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

console.log("Supabase URL:", SUPABASE_URL);

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let galleryInstance = null;

// ELEMENTY UI
const fileInput = document.getElementById("fileInput");
const fileInputLabel = document.getElementById("fileInputLabel");
const uploadBtn = document.getElementById("uploadBtn");
const selectedCount = document.getElementById("selectedCount");

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

  // Odśwież galerię
  loadGallery();
});

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

    const link = document.createElement("a");
    link.href = urlData.publicUrl;
    link.className = "gallery-item";

    const img = document.createElement("img");
    img.src = urlData.publicUrl;
    img.loading = "lazy";

    link.appendChild(img);
    gallery.appendChild(link);
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