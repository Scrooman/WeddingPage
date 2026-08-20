import { createClient } from '@supabase/supabase-js';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import express from 'express';
import cors from 'cors';

import dotenv from 'dotenv';
dotenv.config();

// === KONFIGURACJA ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRINTER_NAME = process.env.PRINTER_NAME;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const PORT = 3000;

// Folder na pliki do druku (NOWE)
const PRINT_DIR = path.join(process.cwd(), "print_jobs");
if (!fs.existsSync(PRINT_DIR)) {
  fs.mkdirSync(PRINT_DIR);
}

// Blokada drukowania (NOWE)
let isPrinting = false;

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// === STATUS DRUKARKI ===
app.get('/status', (req, res) => {
  res.json({ online: true });
});

// === ENDPOINT /print ===
app.post('/print', async (req, res) => {
  console.log("Procesowanie ", req.body);
  const { image_url, event_token } = req.body;

  if (!event_token) {
    return res.status(403).json({ error: "missing_event_token" });
  }

  if (!/^[a-f0-9]{64}$/i.test(event_token)) {
    return res.status(403).json({ error: "invalid_event_token_format" });
  }

  if (!image_url) {
    return res.status(400).json({ error: "Brak image_url" });
  }

  console.log(`Otrzymano żądanie drukowania: ${image_url} z tokenem: ${event_token}`);

  // Walidacja tokenu
  const { data: tokenData, error: tokenError } = await supabase
    .from("event_tokens")
    .select("*")
    .eq("token", event_token)
    .single();

  if (tokenError || !tokenData) {
    return res.status(403).json({ error: "event_token_not_found" });
  }

  if (tokenData.active === false) {
    return res.status(403).json({ error: "event_token_inactive" });
  }

  // Dodanie zadania do kolejki
  const { error } = await supabase
    .from("print_queue")
    .insert({
      image_url,
      status: "pending"
    });

  if (error) {
    console.error("Błąd INSERT:", error);

    if (error.message.includes("too many requests")) {
      return res.status(429).json({ error: "too_many_requests" });
    }

    if (error.message.includes("too many prints of the same image")) {
      return res.status(429).json({ error: "too_many_requests" });
    }

    if (error.message.includes("image is already printing")) {
      return res.status(422).json({ error: "image_is_already_printing" });
    }

    if (error.message.includes("invalid image url")) {
      return res.status(400).json({ error: "invalid_image_url" });
    }

    if (error.message.includes("duplicate key value")) {
      return res.status(409).json({ error: "duplicate_pending" });
    }

    return res.status(500).json({ error: "Supabase INSERT error" });
  }

  res.json({ ok: true });
});

// === FUNKCJA DRUKOWANIA ===
async function printImage(filePath) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const escapedPath = filePath.replace(/'/g, "''");
      const escapedPrinterName = PRINTER_NAME.replace(/'/g, "''");

      const psScript = `
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$imagePath = '${escapedPath}'
$printerName = '${escapedPrinterName}'

if (-not (Test-Path -LiteralPath $imagePath)) {
  throw "Plik nie istnieje: $imagePath"
}

$img = [System.Drawing.Image]::FromFile($imagePath)
$printDoc = New-Object System.Drawing.Printing.PrintDocument
$printDoc.PrinterSettings.PrinterName = $printerName

if (-not $printDoc.PrinterSettings.IsValid) {
  throw "Nieprawidłowa lub niedostępna drukarka: $printerName"
}

$printDoc.DefaultPageSettings.Landscape = $true
$printDoc.DefaultPageSettings.Color = $true

# Papier 10 x 15 cm.
# Jednostką jest 1/100 cala: 394 x 591.
$printDoc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize(
  "Photo 10x15 cm",
  394,
  591
)

$printDoc.Add_PrintPage({
  param($sender, $e)

  # PageBounds obejmuje cały obszar strony.
  # Drukarka może fizycznie mieć niewielkie marginesy.
  $bounds = $e.PageBounds

  $scaleX = $bounds.Width / $img.Width
  $scaleY = $bounds.Height / $img.Height

  # Max powoduje wypełnienie całego papieru.
  # Nadmiar obrazu zostanie przycięty.
  $scale = [Math]::Max($scaleX, $scaleY)

  $drawWidth = [int]($img.Width * $scale)
  $drawHeight = [int]($img.Height * $scale)

  # Wyśrodkowanie i przycięcie obrazu.
  $x = [int]($bounds.Left + (($bounds.Width - $drawWidth) / 2))
  $y = [int]($bounds.Top + (($bounds.Height - $drawHeight) / 2))

  $e.Graphics.DrawImage(
    $img,
    $x,
    $y,
    $drawWidth,
    $drawHeight
  )

  $e.HasMorePages = $false
})

try {
  $printDoc.Print()
  Write-Output "Zadanie wysłane do drukarki: $printerName"
}
finally {
  $img.Dispose()
  $printDoc.Dispose()
}
`;

      const encodedScript = Buffer
        .from(psScript, 'utf16le')
        .toString('base64');

      const child = execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodedScript
        ],
        {
          windowsHide: true,
          maxBuffer: 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error('Błąd drukowania:', stderr || error.message);
            reject(error);
            return;
          }

          console.log(stdout.trim());
          resolve(stdout);
        }
      );

      child.on('error', error => {
        console.error('Nie można uruchomić PowerShell:', error);
        reject(error);
      });

      return;
    }

    const child = execFile(
      'lpr',
      [
        '-P',
        PRINTER_NAME,
        '-o',
        'media=Postcard',
        '-o',
        'fit-to-page',
        filePath
      ],
      error => {
        if (error) {
          console.error('Błąd drukowania:', error);
          reject(error);
          return;
        }

        console.log('Zadanie wysłane do drukarki.');
        resolve();
      }
    );

    child.on('error', reject);
  });
}

// === ROTACJA WERTYKALNYCH ZDJĘĆ (bez przycinania) ===
async function rotateIfVertical(filePath) {
  if (process.platform !== 'win32') return; // System.Drawing dostępne tylko na Windows

  return new Promise((resolve, reject) => {
    const escapedPath = filePath.replace(/'/g, "''");

    const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$imagePath = '${escapedPath}'

# Wczytanie do pamięci, aby nie blokować pliku podczas zapisu
$bytes = [System.IO.File]::ReadAllBytes($imagePath)
$ms = New-Object System.IO.MemoryStream(,$bytes)
$img = [System.Drawing.Image]::FromStream($ms)

if ($img.Height -gt $img.Width) {
  $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
  $img.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
}

$img.Dispose()
$ms.Dispose()
`;

    const encodedScript = Buffer
      .from(psScript, 'utf16le')
      .toString('base64');

    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedScript
      ],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error('Błąd rotacji obrazu:', stderr || error.message);
          reject(error);
          return;
        }

        resolve(stdout);
      }
    );

    child.on('error', error => {
      console.error('Nie można uruchomić PowerShell:', error);
      reject(error);
    });
  });
}

// === PRZETWARZANIE ZADAŃ ===
async function processJob(job) {
  if (isPrinting) {
    console.log("Drukarka zajęta — pomijam zadanie");
    return;
  }

  isPrinting = true;

  console.log(`[ZADANIE] Drukowanie: ${job.image_url}`);

  try {
    // 1. Status: printing
    await supabase.from("print_queue").update({ status: "printing" }).eq("id", job.id);

    // 2. Pobranie pliku (NOWE: zapis do folderu)
    // --- NOWE POBIERANIE PLIKU Z SUPABASE STORAGE ---
    const filePath = job.image_url.replace(/^.*Photos\//, "");
    
    // Determine file extension (handle WebP)
    const ext = filePath.match(/\.webp$/i) ? '.webp' : '.jpg';
    const localFilePath = path.join(PRINT_DIR, `${job.id}${ext}`);

    // Check if file already exists locally (cache)
    if (fs.existsSync(localFilePath)) {
      console.log(`Using cached file: ${job.id}${ext}`);
    } else {
      // Download from Supabase Storage
      const { data: fileStream, error: downloadError } = await supabase.storage
        .from("Photos")
        .download(filePath);

      if (downloadError) {
        console.error("Błąd pobierania pliku:", downloadError);
        throw downloadError;
      }

      fs.writeFileSync(localFilePath, Buffer.from(await fileStream.arrayBuffer()));
      console.log(`Downloaded file: ${job.id}${ext}`);
    }
    // --- KONIEC NOWEGO KODU ---


    // 3. Status: downloaded (NOWE)
    await supabase.from("print_queue").update({ status: "downloaded" }).eq("id", job.id);

    // Obrót wertykalnych zdjęć na bok (bez przycinania); tylko JPEG - System.Drawing nie gwarantuje wsparcia WebP
    if (ext === '.jpg') {
      await rotateIfVertical(localFilePath);
    }

    // 4. Drukowanie
    await printImage(localFilePath);

    // 5. Status: completed (po pozytywnej odpowiedzi z drukarki)
    await supabase.from("print_queue").update({ status: "completed" }).eq("id", job.id);

  } catch (err) {
    console.error("Błąd zadania:", err);
    await supabase.from("print_queue").update({ status: "error" }).eq("id", job.id);
  }

  isPrinting = false;
}

// === NASŁUCHIWANIE REALTIME ===
console.log('Nasłuchiwanie na nowe zadania drukowania...');

supabase
  .channel('print_queue_changes')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'print_queue' },
    (payload) => {
      const job = payload.new;
      if (job.status === 'pending') {
        processJob(job);
      }
    }
  )
  .subscribe();

app.listen(PORT, () => {
  console.log(`Backend działa na porcie ${PORT}`);
});
