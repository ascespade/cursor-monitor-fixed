/**
 * Environment Variable API Config Route
 *
 * Purpose:
 * - Provide server-side API to read CURSOR_API_KEY environment variable
 * - Returns masked API key (last 4 chars) for client-side display
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  try {
    const envApiKey = process.env['CURSOR_API_KEY'] || process.env['NEXT_PUBLIC_CURSOR_API_KEY'];
    
    if (!envApiKey || envApiKey.length < 10) {
      return NextResponse.json({
        exists: false
      });
    }

    return NextResponse.json({
      exists: true,
      maskedKey: `****${envApiKey.slice(-4)}`,
      keyLength: envApiKey.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read environment variable' },
      { status: 500 }
    );
  }
}

