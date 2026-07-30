import pino from 'pino';

// ---------------------------------------------------------------------------
// Bridge-local pino logger. Mirrors the same child-logger shape used by the
// main backend so log lines format identically across the two services.
//
// The bridge is a separate process from the main API; it cannot import
// `backend/src/lib/logger.ts` because the bridge package is independent.
// Keeping the two implementations minimal and aligned makes grep + tail
// across both services easy in local dev.
// ---------------------------------------------------------------------------

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
});

/**
 * Return a child logger bound to a fixed module name. Mirrors the
 * `childLogger(moduleName)` helper the main backend exposes.
 */
export function childLogger(module: string) {
  return logger.child({ module });
}
