// EF de humo DESECHABLE (68.1): valida que los secrets STREAM_* guardados en
// Supabase funcionan contra la API de Cloudflare Stream. Se borra tras el smoke.
// Nunca devuelve valores de secrets — solo longitudes y flags.
Deno.serve(async () => {
  const acc = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const tok = Deno.env.get("STREAM_API_TOKEN") ?? "";
  const kid = Deno.env.get("STREAM_SIGNING_KEY_ID") ?? "";
  const jwk = Deno.env.get("STREAM_SIGNING_JWK") ?? "";
  const out: Record<string, unknown> = {
    acc_len: acc.length, tok_len: tok.length, kid_len: kid.length, jwk_len: jwk.length,
  };
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acc}/stream?per_page=1`,
      { headers: { Authorization: `Bearer ${tok}` } },
    );
    const j = await r.json();
    out.stream_api_ok = j.success === true;
    if (!j.success) out.stream_api_errors = j.errors;
  } catch (e) {
    out.stream_api_ok = false;
    out.fetch_error = String(e);
  }
  try {
    const decoded = JSON.parse(atob(jwk));
    out.jwk_parses = decoded.kty === "RSA";
    out.jwk_kid_matches_key_id = decoded.kid === kid;
  } catch {
    out.jwk_parses = false;
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});
