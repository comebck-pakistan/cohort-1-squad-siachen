import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase browser client.
//
// Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from the build env at
// module-load time. The anon key is shipped to the browser (it's public
// by design); Supabase RLS enforces what each signed-in user can read or
// write. We never reach for the service_role key here — that key lives
// only on the backend.
//
// Module-level singleton — every component that imports this file shares
// the same client, so Supabase JS can keep its session cache + token
// refresh logic in one place.
// ---------------------------------------------------------------------------

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  // Don't crash the entire app on first paint — the auth flow will fail
  // loudly when the user tries to log in, and we want a recoverable error
  // message rather than a white screen.
  console.warn(
    "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. " +
    "Check frontend/.env and restart `npm run dev`."
  );
}

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(URL ?? "", ANON ?? "", {
    auth: {
      // Tokens persist in localStorage so refresh keeps the session.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // we're not using email-link redirects
    },
  });
  return _client;
}
