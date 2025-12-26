/**
 * Example Feature API Route
 *
 * Purpose:
 * - Demonstrate how feature-level API routes can be wired using the
 *   project conventions (validation, typed responses, layering).
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ success: true, data: { message: 'Example feature API is alive.' } });
}
