import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

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

function isValidHashFormat(hash: string) {
  return /^[a-f0-9]{64}$/i.test(hash);
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

// Encoding/resizing now happens client-side; sanity-check JPEG magic bytes since server no longer decodes/re-encodes
async function isJpeg(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
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

    // Client sends indexed groups: file_N, thumbnail_N, hash_N, filename_N
    const indices = new Set<number>();
    for (const key of formData.keys()) {
      const match = key.match(/^file_(\d+)$/);
      if (match) indices.add(Number(match[1]));
    }

    if (indices.size === 0) {
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
    if (indices.size > MAX_FILES) {
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

    // Process files sequentially
    for (const index of [...indices].sort((a, b) => a - b)) {
      const file = formData.get(`file_${index}`);
      const thumbnail = formData.get(`thumbnail_${index}`);
      const hash = String(formData.get(`hash_${index}`) ?? "");
      const filenameRaw = String(formData.get(`filename_${index}`) ?? "");
      const safeName = sanitizeFileName(filenameRaw || `photo_${index}`);

      if (!(file instanceof File) || !(thumbnail instanceof File)) {
        results.rejected.push({ filename: safeName, reason: "missing_file_part" });
        continue;
      }

      // Validate file size
      if (file.size === 0) {
        results.rejected.push({ filename: safeName, reason: "empty_file" });
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        results.rejected.push({ filename: safeName, reason: "file_too_large" });
        continue;
      }

      if (!isValidHashFormat(hash)) {
        results.rejected.push({ filename: safeName, reason: "invalid_hash_format" });
        continue;
      }

      try {
        if (!(await isJpeg(file)) || !(await isJpeg(thumbnail))) {
          results.rejected.push({ filename: safeName, reason: "invalid_image_format" });
          continue;
        }

        // Dedupe check
        const isDuplicate = await checkDuplicate(hash);
        
        if (isDuplicate) {
          results.duplicates.push(safeName);
          continue;
        }

        // Create unique names
        const timestamp = Date.now();
        const originalName = `${timestamp}-${safeName}.jpg`;
        const thumbnailName = `${timestamp}-${safeName}-thumb.jpg`;

        // Upload original JPEG (already encoded client-side)
        const { error: originalError } = await supabase.storage
          .from("Photos")
          .upload(originalName, file, {
            contentType: "image/jpeg",
            upsert: false,
            cacheControl: "3600",
          });

        if (originalError) {
          results.rejected.push({ filename: safeName, reason: originalError.message });
          continue;
        }

        // Upload thumbnail (already encoded client-side)
        const { error: thumbnailError } = await supabase.storage
          .from("Photos")
          .upload(`thumbnails/${thumbnailName}`, thumbnail, {
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
        message: `Wysłano ${results.uploaded.length} z ${indices.size} zdjęć`
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