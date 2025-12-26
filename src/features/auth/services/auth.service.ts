/**
 * AuthService
 *
 * Purpose:
 * - Wrap Supabase auth calls behind a small, typed service layer.
 */
'use client';

import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface AuthServiceDependencies {
  supabase: SupabaseClient;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDependencies) {}

  async signInWithEmail(email: string): Promise<{ user: User | null }> {
    const { data, error } = await this.deps.supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: undefined } });

    if (error) {
      throw error;
    }

    return { user: data.user ?? null };
  }

  async signOut(): Promise<void> {
    const { error } = await this.deps.supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }
}
