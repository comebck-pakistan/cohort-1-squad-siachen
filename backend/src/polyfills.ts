// ---------------------------------------------------------------------------
// Node.js runtime polyfills.
//
// MUST be the first import in src/index.ts. This file is loaded BEFORE
// any other module, including `@supabase/supabase-js`, so we can patch
// globalThis before Supabase's auth-js performs its module-level check.
//
// Currently we polyfill:
//   - WebSocket (Node.js < 22 doesn't have native WebSocket)
//
// This file MUST NOT import anything from `@supabase/*` — those modules
// trigger the very checks we're trying to satisfy.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-console
console.log('[polyfills] checking WebSocket availability');

if (typeof globalThis.WebSocket === 'undefined') {
  // The `ws` package is CommonJS — its module.exports IS the WebSocket
  // class (no `.default`). With esModuleInterop on, `import WebSocket from 'ws'`
  // works, but `require('ws').default` is undefined. So we use the whole
  // module object here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ws = require('ws');

  // Set on both globalThis (modern) and global (older Node API) so that
  // any check (`typeof WebSocket`, `typeof globalThis.WebSocket`,
  // `typeof global.WebSocket`) succeeds.
  globalThis.WebSocket = ws;
  if (typeof global !== 'undefined') {
    (global as { WebSocket: typeof ws }).WebSocket = ws;
  }

  // eslint-disable-next-line no-console
  console.log('[polyfills] WebSocket polyfill applied');
} else {
  // eslint-disable-next-line no-console
  console.log('[polyfills] native WebSocket already present, no polyfill needed');
}