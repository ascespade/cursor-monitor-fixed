/**
 * SupabaseProvider
 *
 * Purpose:
 * - Wrap the React tree with Supabase session context for client components,
 *   using auth-helpers to manage authentication state.
 *
 * Notes:
 * - This is a generic provider; per-project apps can extend it with
 *   additional auth logic or profile fetching.
 */
'use client';

import type { PropsWithChildren } from 'react';
import { useMemo, useEffect, useState } from 'react';
import { SessionContextProvider } from '@supabase/auth-helpers-react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';

export function SupabaseProvider({ children }: PropsWithChildren) {
  const [isClient, setIsClient] = useState(false);
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  // Only run on client side (after hydration)
  useEffect(() => {
    setIsClient(true);
  }, []);

  const supabaseClient = useMemo(() => {
    // During SSR/build time, create a dummy client to avoid hydration mismatch
    if (!isClient || typeof window === 'undefined') {
      // Return a minimal client for SSR (won't be used, just for type safety)
      if (supabaseUrl && supabaseAnonKey) {
        return createClient(supabaseUrl, supabaseAnonKey);
      }
      // If no env vars, create a dummy client with placeholder values
      return createClient('https://placeholder.supabase.co', 'placeholder-key');
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      /**
       * In local / misconfigured environments we avoid throwing a runtime error
       * so the app can still render without Supabase.
       *
       * For production you should configure:
       * - NEXT_PUBLIC_SUPABASE_URL
       * - NEXT_PUBLIC_SUPABASE_ANON_KEY
       * or pass explicit supabaseUrl/supabaseKey to the client creator.
       */
      // Create a dummy client to avoid hydration mismatch
      return createClient('https://placeholder.supabase.co', 'placeholder-key');
    }

    try {
      return createClientComponentClient({
        supabaseUrl,
        supabaseKey: supabaseAnonKey
      });
    } catch (error) {
      // Silently fail during build/runtime if client creation fails
      console.warn('Failed to create Supabase client:', error);
      // Return a dummy client to avoid hydration mismatch
      return createClient('https://placeholder.supabase.co', 'placeholder-key');
    }
  }, [isClient, supabaseUrl, supabaseAnonKey]);

  // Always render SessionContextProvider with consistent structure to avoid hydration mismatch
  return (
    <SessionContextProvider 
      supabaseClient={supabaseClient}
      initialSession={null}
    >
      {children}
    </SessionContextProvider>
  );
}
