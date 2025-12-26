/**
 * GET /api/cloud-agents/configs
 *
 * Purpose:
 * - Return empty list (legacy endpoint for backward compatibility).
 * - Client-side apps should use localStorage-based API configs instead.
 */
import { NextResponse } from 'next/server';

import { ok } from '@/shared/utils/api-response';

export async function GET(): Promise<NextResponse> {
  // Return empty list - client-side apps should use localStorage configs
  return ok({ configs: [] });
}
