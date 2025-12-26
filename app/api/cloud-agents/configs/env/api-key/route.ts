/**
 * Environment Variable API Key Route (Server-side only)
 *
 * Purpose:
 * - Provide server-side API to get full CURSOR_API_KEY for API calls
 * - This endpoint should only be used by server-side code or with proper authentication
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  try {
    const envApiKey = process.env['CURSOR_API_KEY'] || process.env['NEXT_PUBLIC_CURSOR_API_KEY'];
    
    if (!envApiKey || envApiKey.length < 10) {
      return NextResponse.json(
        { error: 'CURSOR_API_KEY not configured' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      apiKey: envApiKey
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read environment variable' },
      { status: 500 }
    );
  }
}

