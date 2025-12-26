/**
 * API Route Template (Next.js App Router)
 *
 * Purpose:
 * - Provide a reference implementation for an API route that follows
 *   the project conventions: Zod validation, typed responses, and
 *   centralized error handling (when available).
 */
import { z } from 'zod';

// Example request schema
const ExampleRequestSchema = z.object({
  id: z.string().uuid()
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  const parseResult = ExampleRequestSchema.safeParse({ id });
  if (!parseResult.success) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          fields: parseResult.error.flatten().fieldErrors
        }
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // TODO: Replace with real use-case / service call.

  return new Response(
    JSON.stringify({ success: true, data: { id: parseResult.data.id } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
