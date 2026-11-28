# Bếp Phương Bắc — Preorder Management

See [spec.md](spec.md). Live: https://vungdv.github.io/coco/

- `web/` Vue 3 + Vite app (`npm ci && npm run dev`). Without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` it runs in **demo mode** (localStorage data).
- `supabase/` migrations, seed, pgTAP tests, `orders` and `voice-commands` Edge Functions ([Voice Command API](supabase/functions/voice-commands/openapi.yaml), [spec.v3.md](spec.v3.md)). Tests: `supabase test db` and `npx deno test supabase/functions`.

## Go live with Supabase
1. `supabase link && supabase db push && supabase functions deploy orders voice-commands`
2. Repo → Settings → Variables: set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; re-run the deploy workflow.
3. Create staff users with `app_metadata: {"role":"staff"}` (Auth dashboard / admin API).
4. Create an API key: insert `encode(sha256('<secret>'::bytea),'hex')` into `api_keys.key_hash`, then
   `curl -X POST $URL/functions/v1/orders -H "x-api-key: <secret>" -d '{"customer_name":"A","quantity":2,"delivery_date":"2026-11-22"}'`.
   Adjust with `"op": "reduce" | "set" | "cancel"` (and optional `"customer_id"`); see [spec.v2.md](spec.v2.md) §4.
