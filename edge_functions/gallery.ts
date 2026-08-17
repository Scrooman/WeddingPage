import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// In-memory cache for signed URLs
const urlCache = new Map<string, { url: string; expiresAt: number }>();

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

  return data;
}

// Get or create signed URL with caching
async function getCachedSignedUrl(
  bucket: string,
  filePath: string,
  expiresIn: number
): Promise<string | null> {
  const cacheKey = `${bucket}:${filePath}`;
  const now = Date.now();
  
  // Check cache
  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }
  
  // Generate new signed URL
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn);
  
  if (error || !data?.signedUrl) {
    return null;
  }
  
  // Cache with 60s buffer before expiry
  const expiresAt = now + (expiresIn - 60) * 1000;
  urlCache.set(cacheKey, { url: data.signedUrl, expiresAt });
  
  return data.signedUrl;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const eventToken = String(body.event_token ?? "");
    const expiresIn = Number(body.expiresIn ?? 3600);
    const limit = Number(body.limit ?? 5);
    const offset = Number(body.offset ?? 0);
    const fetchLimit = limit + 1;

    if (!eventToken) {
      return new Response(
        JSON.stringify({ error: "missing_event_token" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    await validateEventToken(eventToken);

    const { data: files, error: listError } = await supabase.storage
        .from("Photos")
        .list("", { 
          limit: fetchLimit, 
          offset,
          sortBy: { column: "created_at", order: "desc" }
        });

      if (listError) throw new Error(listError.message);

      // Przefiltruj folder "thumbnails" oraz obiekty katalogowe
      const validFiles = (files ?? [])
        .filter((file) => file.metadata?.size > 0 && !file.name.includes("/") && file.name !== "thumbnails")
        .slice(0, limit); // Przytnij dokładnie do prośby klienta (10)

    const rows = await Promise.all(
      validFiles.map(async (file) => {
        // Pobieganie Signed URL oryginalnego zdjęcia (cached)
        const originalUrl = await getCachedSignedUrl("Photos", file.name, expiresIn);
        
        // Pobieranie Signed URL miniatury z rozszerzeniem .jpg (cached)
        const baseNameWithoutExt = file.name.replace(/\.[^.]+$/, "");
        const thumbnailPath = `thumbnails/${baseNameWithoutExt}-thumb.jpg`;
        const thumbnailUrl = await getCachedSignedUrl("Photos", thumbnailPath, expiresIn);

        return {
          id: file.id,
          name: file.name,
          metadata: file.metadata,
          created_at: file.created_at,
          originalUrl,
          thumbnailUrl: thumbnailUrl || originalUrl, // Fallback do oryginału w przypadku braku miniatury
          signedUrl: originalUrl, // Zachowane dla wstecznej kompatybilności z frontendem
        };
      })
    );

    return new Response(
        JSON.stringify({ 
          files: rows,
          // hasMore sprawdzamy na podstawie tego czy w bucie było więcej obiektów niż nasz limit
          hasMore: (files ?? []).length > limit,
          offset,
          limit
        }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600, immutable",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";

    const statusMap: Record<string, number> = {
      invalid_event_token_format: 400,
      missing_event_token: 400,
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
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});