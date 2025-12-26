/**
 * Dashboard Page (Example Protected Area)
 *
 * Purpose:
 * - Demonstrate how an authenticated area could look. This is not a full
 *   auth guard, but a starting point for per-project enhancements.
 */
'use client';

import { useSession, useSupabaseClient } from '@supabase/auth-helpers-react';

export default function DashboardPage() {
  const session = useSession();
  const supabase = useSupabaseClient();

  const handleSignOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 relative z-10">
        <p className="text-xs text-textMuted">You are not signed in. Go to /login to authenticate.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 relative z-10">
      <div className="space-y-3 text-center">
        <p className="text-xs font-mono text-textMuted">Dashboard</p>
        <h1 className="text-xl font-semibold text-white">Welcome</h1>
        <p className="text-xs text-textMuted">Signed in as {session.user.email ?? session.user.id}</p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-2 inline-flex items-center justify-center px-4 py-2 text-xs font-medium text-white bg-cardRaised border border-borderSoft rounded-lg hover:bg-card focus:outline-none focus:ring-2 focus:ring-brand/50"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
