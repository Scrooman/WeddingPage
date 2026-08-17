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

  return data;
}

serve(async (req) => {
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
    const limit = Number(body.limit ?? 200);

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
      .list("", { limit, offset: 0 });

    if (listError) {
      throw new Error(listError.message);
    }

    const rows = await Promise.all(
      (files ?? [])
        .filter((file) => file.metadata?.size > 0)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map(async (file) => {
          const { data: signedData, error: signedError } = await supabase.storage
            .from("Photos")
            .createSignedUrl(file.name, expiresIn);

          return {
            id: file.id,
            name: file.name,
            metadata: file.metadata,
            created_at: file.created_at,
            signedUrl: signedError ? null : signedData?.signedUrl ?? null,
            signedUrlError: signedError ? signedError.message : null,
          };
        })
    );

    return new Response(
      JSON.stringify({ files: rows }),
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