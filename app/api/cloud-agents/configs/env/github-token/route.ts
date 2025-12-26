/**
 * Environment Variable GitHub Token Route (Server-side only)
 *
 * Purpose:
 * - Provide server-side API to get full GITHUB_TOKEN for API calls
 * - This endpoint should only be used by server-side code or with proper authentication
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  try {
    const envToken = process.env['GITHUB_TOKEN'] || process.env['NEXT_PUBLIC_GITHUB_TOKEN'];
    
    if (!envToken || envToken.length < 10) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN not configured' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      token: envToken
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read environment variable' },
      { status: 500 }
    );
  }
}
