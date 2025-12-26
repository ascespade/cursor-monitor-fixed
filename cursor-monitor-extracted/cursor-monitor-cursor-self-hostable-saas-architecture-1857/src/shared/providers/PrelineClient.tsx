/**
 * PrelineClient
 *
 * Purpose:
 * - Ensure Preline's JavaScript is loaded on the client so Tailwind-powered
 *   components (dropdowns, modals, etc.) behave correctly.
 *
 * Notes:
 * - Wrap your app with this component in the RootLayout.
 */
'use client';

import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';

export function PrelineClient({ children }: PropsWithChildren) {
  useEffect(() => {
    // Dynamically import Preline only in the browser to avoid `self`/`window`
    // reference errors during SSR.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    import('preline/preline').catch((error) => {
      // Silently handle preline import errors (non-critical)
      console.warn('Failed to load Preline UI library', error);
    });
  }, []);

  return <>{children}</>;
}
