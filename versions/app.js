import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const PORT = 3000;

app.use(cors({
  origin: "http://127.0.0.1:5500",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// === STATUS DRUKARKI ===
app.get('/status', (req, res) => {
  res.json({ online: true });
});

// === NOWY ENDPOINT /print ===
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
  // Walidacja tokenu w bazie Supabase
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

  console.log("Odebrano zadanie drukowania:", image_url);

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

    // 🔥 WYKRYWANIE BŁĘDU UNIKALNOŚCI
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
    let command = '';

    if (process.platform === 'win32') {
      command = `powershell -Command "Start-Process -FilePath '${filePath}' -Verb PrintTo -ArgumentList '${PRINTER_NAME}' -WindowStyle Hidden"`;
    } else {
      command = `lpr -P "${PRINTER_NAME}" -o media=Postcard "${filePath}"`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Błąd drukowania:', error);
        reject(error);
      } else {
        console.log('Wysłano do drukarki!');
        resolve(stdout);
      }
    });
  });
}

// === PRZETWARZANIE ZADAŃ ===
async function processJob(job) {
  console.log(`[ZADANIE] Drukowanie: ${job.image_url}`);

  try {
    await supabase.from('print_queue').update({ status: 'printing' }).eq('id', job.id);

    const tempPath = path.join(process.cwd(), `temp_${job.id}.jpg`);
    const writer = fs.createWriteStream(tempPath);

    const response = await axios({
      url: job.image_url,
      method: 'GET',
      responseType: 'stream',
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await printImage(tempPath);

    await supabase.from('print_queue').update({ status: 'completed' }).eq('id', job.id);

    fs.unlinkSync(tempPath);

  } catch (err) {
    console.error('Błąd zadania:', err);
    await supabase.from('print_queue').update({ status: 'error' }).eq('id', job.id);
  }
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
