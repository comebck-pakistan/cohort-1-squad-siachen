import pino, { Logger, LoggerOptions } from 'pino';

// ---------------------------------------------------------------------------
// Structured logger — production-grade criterion
//
// Why pino: structured JSON logs in production, colorized pretty logs in dev.
// Each module calls `childLogger('module-name')` so logs can be filtered by
// module field in production (e.g. `jq 'select(.module=="whatsapp-web.client")'`).
// ---------------------------------------------------------------------------

const isProduction = process.env.NODE_ENV === 'production';

const baseConfig: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  base: {
    service: 'halo-backend',
    env: process.env.NODE_ENV ?? 'development',
  },
  // ISO timestamps so logs are sortable + machine-parseable in production.
  // pino-pretty overrides the rendered format with translateTime in dev.
  timestamp: pino.stdTimeFunctions.isoTime,
};

// pino-pretty is dev-only — it sits in devDependencies and would otherwise
// bloat the production bundle. We only enable the transport when not in
// production.
if (!isProduction) {
  baseConfig.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  };
}

export const logger: Logger = pino(baseConfig);

/**
 * Create a child logger scoped to a module. The child carries a `module`
 * field on every log line, which lets us filter logs by module in
 * production without changing call sites.
 *
 * Usage:
 *   const log = childLogger('whatsapp-web.client');
 *   log.info({ qr: true }, 'qr received');
 *
 * Production-grade criterion: every module must use its own child logger.
 * No bare `console.log` calls anywhere in the codebase.
 */
export function childLogger(module: string): Logger {
  return logger.child({ module });
}