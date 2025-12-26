/**
 * RootLayout (Global Application Shell)
 *
 * Purpose:
 * - Define the top-level HTML structure and global layout for all App Router routes.
 * - Apply global styling (dark theme) and shared wrappers/providers around pages.
 *
 * Notes:
 * - Keep this component free of feature-specific logic; it should remain a thin shell.
 */
import type { Metadata } from 'next';
import './globals.css';

import { PrelineClient } from '@/shared/providers/PrelineClient';
import { SupabaseProvider } from '@/shared/providers/SupabaseProvider';

export const metadata: Metadata = {
  title: 'Cursor Monitor Starter',
  description: 'Clean Next.js App Router starter with architecture and AI agent prompts.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-hs-theme="dark">
      <body className="min-h-screen bg-layer text-white antialiased relative">
        <PrelineClient>
          <SupabaseProvider>{children}</SupabaseProvider>
        </PrelineClient>
      </body>
    </html>
  );
}
