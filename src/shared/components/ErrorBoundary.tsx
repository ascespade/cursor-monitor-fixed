/**
 * ErrorBoundary
 *
 * Purpose:
 * - Provide a simple client-side error boundary for catching render errors
 *   in React component trees.
 */
'use client';

import type { PropsWithChildren, ReactNode } from 'react';
import React from 'react';

interface ErrorBoundaryProps extends PropsWithChildren {
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    // Logging can be wired to logger here when needed.
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-4 border border-red-700 bg-red-900/40 text-xs text-red-100 rounded-lg">
          Something went wrong.
        </div>
      );
    }

    return this.props.children;
  }
}
