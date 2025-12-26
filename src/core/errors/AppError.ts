/**
 * AppError and HTTP Error Types
 *
 * Purpose:
 * - Provide a small hierarchy of application errors that can be mapped
 *   to HTTP responses in API routes.
 */
export abstract class AppError extends Error {
  abstract statusCode: number;
  abstract code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  statusCode = 400;
  code = 'VALIDATION_ERROR' as const;

  constructor(message: string, public readonly fields?: Record<string, string[]>) {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  statusCode = 401;
  code = 'UNAUTHORIZED' as const;

  constructor(message = 'Unauthorized') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  statusCode = 403;
  code = 'FORBIDDEN' as const;

  constructor(message = 'Forbidden') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  statusCode = 404;
  code = 'NOT_FOUND' as const;

  constructor(message = 'Not found') {
    super(message);
  }
}

export class InternalServerError extends AppError {
  statusCode = 500;
  code = 'INTERNAL_SERVER_ERROR' as const;

  constructor(message = 'Internal server error') {
    super(message);
  }
}
