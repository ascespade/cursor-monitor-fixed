/**
 * API Error Handler
 *
 * Purpose:
 * - Map thrown errors (including AppError subclasses) into consistent
 *   HTTP JSON responses, and optionally log unexpected errors.
 */
import { NextResponse } from 'next/server';

import { InternalServerError, AppError, ValidationError } from '@/core/errors/AppError';
import { error } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';

export function handleApiError(err: unknown): NextResponse {
  const errorInstance = normalizeError(err);

  if (errorInstance instanceof ValidationError) {
    return error(
      {
        code: errorInstance.code,
        message: errorInstance.message,
        fields: errorInstance.fields
      },
      errorInstance.statusCode
    );
  }

  if (errorInstance instanceof AppError) {
    return error(
      {
        code: errorInstance.code,
        message: errorInstance.message
      },
      errorInstance.statusCode
    );
  }

  // Fallback for truly unknown errors
  logger.error('Unhandled API error', { error: String(err) });
  const fallback = new InternalServerError();
  return error(
    {
      code: fallback.code,
      message: fallback.message
    },
    fallback.statusCode
  );
}

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new InternalServerError('Unknown error type');
}
