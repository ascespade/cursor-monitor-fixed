/**
 * Hook Template
 *
 * Purpose:
 * - Provide a reference for custom React hooks with typed inputs/outputs
 *   and minimal side effects.
 */
'use client';

import { useState } from 'react';

export interface UseExampleOptions {
  initialValue?: number;
}

export function useExample(options: UseExampleOptions = {}): { value: number; increment: () => void } {
  const [value, setValue] = useState(options.initialValue ?? 0);

  const increment = (): void => {
    setValue((prev) => prev + 1);
  };

  return { value, increment };
}
