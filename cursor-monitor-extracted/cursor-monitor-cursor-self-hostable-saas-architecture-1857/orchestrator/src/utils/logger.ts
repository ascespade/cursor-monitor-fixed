/**
 * Logger Utility
 * 
 * Simple structured logger for the orchestrator
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const payload = context ? { message, ...context } : { message };
  
  const logLine = JSON.stringify({
    timestamp,
    level,
    ...payload
  });
  
  // eslint-disable-next-line no-console
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  consoleFn(logLine);
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (process.env['LOG_LEVEL'] === 'debug') {
      log('debug', message, context);
    }
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

