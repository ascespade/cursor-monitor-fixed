/**
 * GET /api/profile
 *
 * Purpose:
 * - Example protected API route using Supabase auth helpers, centralized
 *   error handling, and consistent response envelope.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

import { UnauthorizedError } from '@/core/errors/AppError';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    const { data, error } = await supabase.auth.getUser();

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new UnauthorizedError('User not authenticated');
    }

    const profile = {
      id: data.user.id,
      email: data.user.email,
      createdAt: data.user.created_at
    };

    return ok(profile);
  } catch (err) {
    return handleApiError(err);
  }
}
