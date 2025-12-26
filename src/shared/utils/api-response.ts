/**
 * API Response Helpers
 *
 * Purpose:
 * - Provide typed helpers for building consistent JSON responses from
 *   Next.js App Router route handlers.
 */
import { NextResponse } from 'next/server';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status: 200, ...init });
}

export function created<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status: 201, ...init });
}

export function error(payload: ApiErrorPayload['error'], status: number): NextResponse<ApiErrorPayload> {
  return NextResponse.json({ success: false, error: payload }, { status });
}
