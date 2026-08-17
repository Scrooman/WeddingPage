import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const THUMBNAIL_SIZE = 300;
const JPEG_QUALITY_ORIGINAL = 85;
const JPEG_QUALITY_THUMBNAIL = 75;

const ALLOWED_ORIGINS = [
  "https://slub-andzi-i-kuby.pl",
  "https://scrooman.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
  };
}

function isValidTokenFormat(token: string) {
  return /^[a-f0-9]{64}$/i.test(token);
}

async function validateEventToken(eventToken: string) {
  if (!eventToken || !isValidTokenFormat(eventToken)) {
    throw new Error("invalid_event_token_format");
  }

  const { data, error } = await supabase
    .from("event_tokens")
    .select("id, token, active, expires_at")
    .eq("token", eventToken)
    .maybeSingle();

  if (error) {
    throw new Error("token_lookup_failed");
  }

  if (!data) {
    throw new Error("token_not_found");
  }

  if (data.active === false) {
    throw new Error("token_inactive");
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    throw new Error("token_expired");
  }
}

// Hash first 512KB of file for deduplication
async function hashFile(file: File): Promise<string> {
  const chunkSize = 512 * 1024; // 512KB
  const buffer = await file.slice(0, chunkSize).arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate JPEG thumbnail
async function generateThumbnail(fileBuffer: ArrayBuffer): Promise<Uint8Array> {
  const image = await Image.decode(new Uint8Array(fileBuffer));
  
  // Calculate aspect ratio resize
  const aspectRatio = image.width / image.height;
  let newWidth = THUMBNAIL_SIZE;
  let newHeight = THUMBNAIL_SIZE;
  
  if (aspectRatio > 1) {
    newHeight = Math.round(THUMBNAIL_SIZE / aspectRatio);
  } else {
    newWidth = Math.round(THUMBNAIL_SIZE * aspectRatio);
  }
  
  const resized = image.resize(newWidth, newHeight);
  return await resized.encodeJPEG(JPEG_QUALITY_THUMBNAIL);
}

// Convert to JPEG
async function convertToJPEG(fileBuffer: ArrayBuffer, quality: number): Promise<Uint8Array> {
  const image = await Image.decode(new Uint8Array(fileBuffer));
  return await image.encodeJPEG(quality);
}

// Check if file hash exists in database
async function checkDuplicate(hash: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("hash")
    .eq("hash", hash)
    .maybeSingle();
  
  return !error && data !== null;
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(req),
    });
  }

  try {
    const formData = await req.formData();
    const eventToken = String(formData.get("event_token") ?? "");
    
    if (!eventToken) {
      return new Response(
        JSON.stringify({ error: "missing_event_token" }),
        {
          status: 400,
          headers: {
            ...getCorsHeaders(req),
            "Content-Type": "application/json",
          },
        }
      );
    }

    await validateEventToken(eventToken);

    // Get all files from FormData
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "file" && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return new Response(
        JSON.stringify({ error: "missing_file" }),
        {
          status: 400,
          headers: {
            ...getCorsHeaders(req),
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Validate max 5 files
    if (files.length > 5) {
      return new Response(
        JSON.stringify({ 
          error: "too_many_files",
          message: "Maksymalnie 5 zdjęć na raz"
        }),
        {
          status: 400,
          headers: {
            ...getCorsHeaders(req),
            "Content-Type": "application/json",
          },
        }
      );
    }

    const results = {
      uploaded: [] as string[],
      rejected: [] as { filename: string; reason: string }[],
      duplicates: [] as string[]
    };

    // Process files sequentially to avoid memory issues
    for (const file of files) {
      const safeName = sanitizeFileName(file.name);

      // Validate file size
      if (file.size === 0) {
        results.rejected.push({ filename: safeName, reason: "empty_file" });
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        results.rejected.push({ filename: safeName, reason: "file_too_large" });
        continue;
      }

      try {
        // Hash for deduplication
        const hash = await hashFile(file);
        const isDuplicate = await checkDuplicate(hash);
        
        if (isDuplicate) {
          results.duplicates.push(safeName);
          continue;
        }

        // Read file buffer once
        const fileBuffer = await file.arrayBuffer();

        // Convert to JPEG
        const jpegOriginal = await convertToJPEG(fileBuffer, JPEG_QUALITY_ORIGINAL);
        
        // Generate thumbnail
        const thumbnailJPEG = await generateThumbnail(fileBuffer);

        // Create unique names
        const timestamp = Date.now();
        const baseNameWithoutExt = safeName.replace(/\.[^.]+$/, "");
        const originalName = `${timestamp}-${baseNameWithoutExt}.jpg`;
        const thumbnailName = `${timestamp}-${baseNameWithoutExt}-thumb.jpg`;

        // Upload original JPEG
        const { error: originalError } = await supabase.storage
          .from("Photos")
          .upload(originalName, jpegOriginal, {
            contentType: "image/jpeg",
            upsert: false,
            cacheControl: "3600",
          });

        if (originalError) {
          results.rejected.push({ filename: safeName, reason: originalError.message });
          continue;
        }

        // Upload thumbnail
        const { error: thumbnailError } = await supabase.storage
          .from("Photos")
          .upload(`thumbnails/${thumbnailName}`, thumbnailJPEG, {
            contentType: "image/jpeg",
            upsert: false,
            cacheControl: "3600",
          });

        if (thumbnailError) {
          // Thumbnail failed but original succeeded - not critical
          console.warn(`Thumbnail upload failed for ${safeName}:`, thumbnailError);
        }

        // Store hash in database
        await supabase
          .from("uploaded_files")
          .insert({
            hash,
            filename: originalName
          });

        results.uploaded.push(originalName);

      } catch (err) {
        const message = err instanceof Error ? err.message : "processing_error";
        results.rejected.push({ filename: safeName, reason: message });
      }
    }

    return new Response(
      JSON.stringify({ 
        ok: true, 
        ...results,
        message: `Wysłano ${results.uploaded.length} z ${files.length} zdjęć`
      }),
      {
        status: 200,
        headers: {
          ...getCorsHeaders(req),
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";

    const statusMap: Record<string, number> = {
      invalid_event_token_format: 400,
      missing_event_token: 400,
      missing_file: 400,
      empty_file: 400,
      token_not_found: 403,
      token_inactive: 403,
      token_expired: 403,
      token_lookup_failed: 500,
    };

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: statusMap[message] ?? 500,
        headers: {
          ...getCorsHeaders(req),
          "Content-Type": "application/json",
        },
      }
    );
  }
});