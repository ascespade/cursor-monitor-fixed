/**
 * useCloudAgentsActions
 *
 * Purpose:
 * - Provide client-side helpers for launching, stopping, deleting, and
 *   adding follow-ups to Cursor Cloud Agents.
 */
'use client';

import { useState } from 'react';

import {
  addCloudAgentFollowup,
  deleteCloudAgent,
  launchCloudAgent,
  stopCloudAgent
} from '@/features/cloud-agents/services/cloud-agents.service';

interface UseCloudAgentsActionsOptions {
  configId?: string;
  apiKey?: string; // API key from localStorage (takes priority over configId)
}

interface UseCloudAgentsActionsState {
  busy: boolean;
  error?: string;
}

export function useCloudAgentsActions(options: UseCloudAgentsActionsOptions = {}): {
  state: UseCloudAgentsActionsState;
  launch: (args: {
    promptText: string;
    repository: string;
    ref?: string;
    model?: string;
    autoCreatePr?: boolean;
  }) => Promise<void>;
  stop: (agentId: string) => Promise<void>;
  remove: (agentId: string) => Promise<void>;
  followup: (agentId: string, promptText: string) => Promise<void>;
} {
  const { configId, apiKey } = options;
  const [state, setState] = useState<UseCloudAgentsActionsState>({ busy: false });

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setState({ busy: true, error: undefined });
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      setState({ busy: false, error: message });
      return;
    }
    setState({ busy: false, error: undefined });
  };

  const launch = async (args: {
    promptText: string;
    repository: string;
    ref?: string;
    model?: string;
    autoCreatePr?: boolean;
  }): Promise<void> => {
    await withBusy(async () => {
      await launchCloudAgent({
        apiKey,
        configId,
        promptText: args.promptText,
        repository: args.repository,
        ref: args.ref,
        model: args.model,
        autoCreatePr: args.autoCreatePr
      });
    });
  };

  const stop = async (agentId: string): Promise<void> => {
    await withBusy(async () => {
      await stopCloudAgent(agentId, apiKey ? { apiKey } : { configId });
    });
  };

  const remove = async (agentId: string): Promise<void> => {
    await withBusy(async () => {
      await deleteCloudAgent(agentId, apiKey ? { apiKey } : { configId });
    });
  };

  const followup = async (agentId: string, promptText: string): Promise<void> => {
    await withBusy(async () => {
      await addCloudAgentFollowup(agentId, { apiKey, configId, promptText });
    });
  };

  return {
    state,
    launch,
    stop,
    remove,
    followup
  };
}
