import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:5500",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
};

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
      headers: corsHeaders,
    });
  }

  try {
    const formData = await req.formData();
    const eventToken = String(formData.get("event_token") ?? "");
    const file = formData.get("file");

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

    if (!(file instanceof File)) {
      return new Response(
        JSON.stringify({ error: "missing_file" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (file.size === 0) {
      return new Response(
        JSON.stringify({ error: "empty_file" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const safeName = sanitizeFileName(file.name);
    const objectName = `${Date.now()}-${safeName}`;

    const { data, error } = await supabase.storage
      .from("Photos")
      .upload(objectName, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
        cacheControl: "3600",
      });

    if (error) {
      throw new Error(error.message);
    }

    return new Response(
      JSON.stringify({ ok: true, file: data?.path ?? objectName }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
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
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});