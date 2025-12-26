/**
 * Logger Utility
 *
 * Purpose:
 * - Provide a minimal structured logging helper that can be swapped out
 *   for a more advanced logger (e.g. pino) without changing call sites.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const payload = context ? { message, ...context } : { message };

  // eslint-disable-next-line no-console
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  consoleFn(JSON.stringify({ level, ...payload }));
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    log('debug', message, context);
  },
  info(message: string, context?: LogContext): void {
    log('info', message, context);
  },
  warn(message: string, context?: LogContext): void {
    log('warn', message, context);
  },
  error(message: string, context?: LogContext): void {
    log('error', message, context);
  }
};
