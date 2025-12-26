/**
 * AuthEmailForm
 *
 * Purpose:
 * - Simple email-based login form using Supabase magic links, built
 *   with Tailwind + Preline-friendly markup.
 */
'use client';

import type { FC } from 'react';

import { useAuthForm } from '@/features/auth/hooks/use-auth-form.hook';

export const AuthEmailForm: FC = () => {
  const { email, status, error, setEmail, signIn } = useAuthForm();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await signIn();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm w-full">
      <div>
        <label htmlFor="email" className="block text-xs font-medium text-white mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="py-2 px-3 block w-full border border-borderSoft rounded-lg text-sm bg-card text-white focus:outline-none focus:ring-2 focus:ring-brand/50"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        className="inline-flex items-center justify-center gap-1 px-4 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-60"
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? 'Sending magic link…' : 'Send magic link'}
      </button>

      {status === 'success' && (
        <p className="text-xs text-green-400 mt-1">Check your email for a login link.</p>
      )}
    </form>
  );
};
