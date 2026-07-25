import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase client factory.
//
// The WebSocket polyfill lives in ./polyfills.ts (imported FIRST by
// src/index.ts) so @supabase/auth-js's module-level check passes on
// Node.js < 22.
//
// This file is intentionally minimal — no env validation happens at
// module-load time, only when getSupabase() is first called, so unit
// tests can import this file without env vars set.
// ---------------------------------------------------------------------------

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'
    );
  }

  _client = createClient(url, key);
  return _client;
}