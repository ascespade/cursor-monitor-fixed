/**
 * Error Handler Utility
 * 
 * Purpose:
 * - Standardize error handling across the system
 * - Provide user-friendly error messages
 * - Categorize errors for proper handling
 * - Follow international best practices (RFC 7807 Problem Details)
 */

export interface ErrorDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  timestamp: string;
  errorCode?: string;
  shouldRetry?: boolean;
  retryAfter?: number;
  metadata?: Record<string, unknown>;
}

export enum ErrorCategory {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  API_ERROR = 'API_ERROR',
  MODEL_ERROR = 'MODEL_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Parse error and create structured error details
 * Follows RFC 7807 Problem Details for HTTP APIs
 */
export function parseError(error: unknown, context?: Record<string, unknown>): ErrorDetails {
  const timestamp = new Date().toISOString();
  
  if (error instanceof Error) {
    const message = error.message;
    
    // Validation errors
    if (message.includes('VALIDATION_ERROR')) {
      return {
        type: 'https://cursor-monitor.dev/errors/validation',
        title: 'Validation Error',
        status: 400,
        detail: message.replace('VALIDATION_ERROR: ', ''),
        timestamp,
        errorCode: ErrorCategory.VALIDATION_ERROR,
        shouldRetry: false,
        metadata: context
      };
    }
    
    // Authentication errors
    if (message.includes('AUTH_FAILED') || message.includes('Invalid API key')) {
      return {
        type: 'https://cursor-monitor.dev/errors/authentication',
        title: 'Authentication Failed',
        status: 401,
        detail: 'Invalid or missing API key. Please check your credentials.',
        timestamp,
        errorCode: ErrorCategory.AUTH_ERROR,
        shouldRetry: false,
        metadata: context
      };
    }
    
    // Rate limit errors
    if (message.includes('RATE_LIMIT')) {
      return {
        type: 'https://cursor-monitor.dev/errors/rate-limit',
        title: 'Rate Limit Exceeded',
        status: 429,
        detail: 'Too many requests. Please try again later.',
        timestamp,
        errorCode: ErrorCategory.RATE_LIMIT_ERROR,
        shouldRetry: true,
        retryAfter: 60, // seconds
        metadata: context
      };
    }
    
    // Model errors
    if (message.includes('Model') && (message.includes('not available') || message.includes('invalid'))) {
      return {
        type: 'https://cursor-monitor.dev/errors/model',
        title: 'Invalid Model',
        status: 400,
        detail: 'The selected model is not available. Please choose a different model.',
        timestamp,
        errorCode: ErrorCategory.MODEL_ERROR,
        shouldRetry: false,
        metadata: {
          ...context,
          originalMessage: message
        }
      };
    }
    
    // API errors
    if (message.includes('CURSOR_API_ERROR')) {
      const statusMatch = message.match(/CURSOR_API_ERROR: (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
      
      return {
        type: 'https://cursor-monitor.dev/errors/api',
        title: 'API Error',
        status,
        detail: message.replace('CURSOR_API_ERROR: ', ''),
        timestamp,
        errorCode: ErrorCategory.API_ERROR,
        shouldRetry: status >= 500, // Retry on server errors
        metadata: {
          ...context,
          originalMessage: message
        }
      };
    }
    
    // Network errors
    if (message.includes('network') || message.includes('fetch') || message.includes('ECONNREFUSED')) {
      return {
        type: 'https://cursor-monitor.dev/errors/network',
        title: 'Network Error',
        status: 503,
        detail: 'Network connection failed. Please check your connection and try again.',
        timestamp,
        errorCode: ErrorCategory.NETWORK_ERROR,
        shouldRetry: true,
        retryAfter: 5,
        metadata: context
      };
    }
  }
  
  // Unknown error
  return {
    type: 'https://cursor-monitor.dev/errors/unknown',
    title: 'Unexpected Error',
    status: 500,
    detail: error instanceof Error ? error.message : 'An unexpected error occurred',
    timestamp,
    errorCode: ErrorCategory.UNKNOWN_ERROR,
    shouldRetry: false,
    metadata: {
      ...context,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    }
  };
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: unknown): string {
  const errorDetails = parseError(error);
  return errorDetails.detail;
}

/**
 * Check if error should trigger retry
 */
export function shouldRetryError(error: unknown): boolean {
  const errorDetails = parseError(error);
  return errorDetails.shouldRetry === true;
}

/**
 * Get retry delay in milliseconds
 */
export function getRetryDelay(error: unknown): number {
  const errorDetails = parseError(error);
  return (errorDetails.retryAfter || 0) * 1000;
}

