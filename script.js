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

// ----------------------
// UPLOAD ZDJĘĆ
// ----------------------
document.getElementById("uploadBtn").addEventListener("click", async () => {
  const files = document.getElementById("fileInput").files;

  console.log("Wybrane pliki:", files);

  if (!files.length) return alert("Wybierz zdjęcia!");

  for (const file of files) {
    const safeName = sanitizeFileName(file.name);
    const fileName = `${Date.now()}-${safeName}`;

    console.log("Wysyłam plik:", fileName);

    const { data, error } = await client.storage
      .from("Photos") // Upewnij się, że to dokładna nazwa bucketu
      .upload(fileName, file);
    console.log("Upload response:", data, error);

    if (error) {
      console.error("Błąd uploadu:", error);
      alert("Błąd podczas wysyłania zdjęcia.");
      return;
    }

    console.log("Plik wysłany OK:", fileName);
  }

  loadGallery();
});

// ----------------------
// ŁADOWANIE GALERII
// ----------------------
async function loadGallery() {
  console.log("Ładuję galerię…");

  const gallery = document.getElementById("gallery");

  // LISTUJEMY ROOT BUCKETU
  const { data: files, error } = await client.storage
    .from("Photos")
    .list("", { limit: 200 });

  console.log("Root list():", files);
  console.log("Błąd list():", error);

  if (error) {
    console.error("Błąd pobierania listy plików:", error);
    return;
  }

  gallery.innerHTML = "";

  // USUWAMY FILTR — wszystkie elementy to pliki
  const imageFiles = files;

  console.log("Pliki do wyświetlenia:", imageFiles);

  for (const file of imageFiles) {
    const fullPath = file.name;

    const { data: urlData } = client.storage
      .from("Photos")
      .getPublicUrl(fullPath);

    console.log("Public URL:", urlData.publicUrl);

    const link = document.createElement("a");
    link.href = urlData.publicUrl;
    link.className = "gallery-item";

    const img = document.createElement("img");
    img.src = urlData.publicUrl;
    img.loading = "lazy";

    link.appendChild(img);
    gallery.appendChild(link);
  }

  console.log("Elementy galerii:", gallery.children.length);

  if (galleryInstance) {
    galleryInstance.destroy(true);
  }

  galleryInstance = lightGallery(gallery, {
    selector: ".gallery-item",
    plugins: [lgZoom, lgThumbnail],
    speed: 300
  });

  console.log("LightGallery zainicjalizowane.");
}



loadGallery();
