/**
 * Login Page
 *
 * Purpose:
 * - Provide a minimal Supabase email login experience that can be
 *   extended per-project.
 */
import { AuthEmailForm } from '@/features/auth/components/AuthEmailForm';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 relative z-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <p className="text-xs font-mono text-textMuted">Auth</p>
          <h1 className="text-xl font-semibold text-white">Sign in</h1>
          <p className="text-xs text-textMuted">Use your email to receive a magic login link.</p>
        </div>
        <AuthEmailForm />
      </div>
    </main>
  );
}
