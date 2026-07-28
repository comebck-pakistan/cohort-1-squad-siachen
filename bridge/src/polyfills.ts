// ---------------------------------------------------------------------------
// Bridge-side Node runtime polyfills. Must be imported FIRST in src/index.ts
// so it patches globalThis before any other module's module-level check.
//
// Mirrors backend/src/polyfills.ts so the two services' startup shape is
// consistent in dev logs.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-console
console.log('[polyfills] checking WebSocket availability');

if (typeof globalThis.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ws = require('ws');
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
