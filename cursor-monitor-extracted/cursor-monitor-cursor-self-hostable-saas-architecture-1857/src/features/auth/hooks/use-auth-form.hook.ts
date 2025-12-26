/**
 * useAuthForm
 *
 * Purpose:
 * - Provide a minimal email-based auth flow using Supabase magic links.
 */
'use client';

import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { useState } from 'react';

import { AuthService } from '@/features/auth/services/auth.service';

interface UseAuthFormState {
  email: string;
  status: 'idle' | 'submitting' | 'success' | 'error';
  error?: string;
}

export function useAuthForm(): {
  email: string;
  status: UseAuthFormState['status'];
  error?: string;
  setEmail: (value: string) => void;
  signIn: () => Promise<void>;
} {
  const supabase = useSupabaseClient();
  const [state, setState] = useState<UseAuthFormState>({ email: '', status: 'idle' });

  const service = new AuthService({ supabase });

  const setEmail = (value: string): void => {
    setState((prev) => ({ ...prev, email: value }));
  };

  const signIn = async (): Promise<void> => {
    if (!state.email) {
      setState((prev) => ({ ...prev, status: 'error', error: 'Email is required' }));
      return;
    }

    setState((prev) => ({ ...prev, status: 'submitting', error: undefined }));

    try {
      await service.signInWithEmail(state.email);
      setState((prev) => ({ ...prev, status: 'success' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({ ...prev, status: 'error', error: message }));
    }
  };

  return {
    email: state.email,
    status: state.status,
    error: state.error,
    setEmail,
    signIn
  };
}
