/**
 * useCloudAgents - Smart Message Fetching
 *
 * Purpose:
 * - First load: fetch ALL messages and store count
 * - Background poll: fetch ALL, compare counts, add ONLY new messages (the difference)
 * - No re-adding existing messages
 */
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

import type { CursorAgent, CursorConversationResponse } from '@/features/cloud-agents/types';
import {
  fetchCloudAgents,
  fetchCloudAgentConversation,
  fetchCloudAgentUserInfo
} from '@/features/cloud-agents/services/cloud-agents.service';

interface UseCloudAgentsOptions {
  configId?: string;
  apiKey?: string;
  pollIntervalMs?: number;
  conversationPollIntervalMs?: number;
}

interface UseCloudAgentsState {
  agents: CursorAgent[];
  selectedAgentId?: string;
  conversation?: CursorConversationResponse;
  conversationsByAgentId: Record<string, CursorConversationResponse>;
  loading: boolean;
  error?: string;
  userInfoLoading: boolean;
  userInfoError?: string;
  userInfo?: {
    apiKeyName?: string;
    userEmail?: string;
  };
  isConversationLoading: boolean;
  // Track message count per agent to detect new messages efficiently
  messageCountByAgentId: Record<string, number>;
}

export function useCloudAgents(options: UseCloudAgentsOptions = {}): {
  state: UseCloudAgentsState;
  selectAgent: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshConversation: () => Promise<void>;
  addMessageToConversation: (agentId: string, message: { type: string; text: string; id?: string; createdAt?: string }) => void;
  markAllMessagesRead: () => void;
} {
  const [state, setState] = useState<UseCloudAgentsState>({
    agents: [],
    conversationsByAgentId: {},
    loading: false,
    userInfoLoading: false,
    messageCountByAgentId: {},
    isConversationLoading: false
  });

  const { configId, apiKey, pollIntervalMs, conversationPollIntervalMs = 5000 } = options;

  // Refs for polling management
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef<boolean>(false);
  const currentAgentIdRef = useRef<string>('');

  // Load user info
  const loadUserInfo = useCallback(async (): Promise<void> => {
    if (!apiKey && !configId) {
      setState((prev) => ({
        ...prev,
        userInfoLoading: false,
        userInfoError: undefined
      }));
      return;
    }

    setState((prev) => ({ ...prev, userInfoLoading: true, userInfoError: undefined }));
    try {
      const info = await fetchCloudAgentUserInfo(apiKey ? { apiKey } : { configId });
      setState((prev) => ({
        ...prev,
        userInfoLoading: false,
        userInfo: {
          apiKeyName: info.apiKeyName,
          userEmail: info.userEmail
        }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load API user info';
      setState((prev) => ({ ...prev, userInfoLoading: false, userInfoError: message }));
    }
  }, [apiKey, configId]);

  // Load all agents
  const loadAgents = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const data = await fetchCloudAgents({ apiKey, configId, limit: 50 });
      setState((prev) => ({ ...prev, agents: data.agents ?? [], loading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agents';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [apiKey, configId]);

  // Load conversation for an agent
  const loadConversation = useCallback(async (agentId: string, isInitialLoad = true): Promise<void> => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await fetchCloudAgentConversation(agentId, apiKey ? { apiKey } : { configId }, controller.signal);
      const serverMessages = data.messages ?? [];
      const serverMessageCount = serverMessages.length;

      setState((prev) => {
        const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
        const currentMessages = currentConversation?.messages ?? [];
        const currentMessageCount = currentMessages.length;

        // Get last known count for this agent
        const lastKnownCount = prev.messageCountByAgentId[agentId] ?? currentMessageCount;

        if (isInitialLoad) {
          // First load: take ALL messages and update count
          const updatedConversation: CursorConversationResponse = {
            ...data,
            messages: serverMessages
          };

          return {
            ...prev,
            conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
            conversationsByAgentId: {
              ...prev.conversationsByAgentId,
              [agentId]: updatedConversation
            },
            messageCountByAgentId: {
              ...prev.messageCountByAgentId,
              [agentId]: serverMessageCount
            },
            isConversationLoading: false
          };
        }

        // Background poll: only add NEW messages (difference between counts)
        if (serverMessageCount <= lastKnownCount) {
          // No new messages or messages were removed - do nothing
          return prev;
        }

        // Calculate how many new messages to add
        const newMessagesCount = serverMessageCount - lastKnownCount;
        const newMessages = serverMessages.slice(lastKnownCount, serverMessageCount);

        // Add only the new messages to the end
        const updatedMessages = [...currentMessages, ...newMessages];

        const updatedConversation: CursorConversationResponse = {
          ...data,
          messages: updatedMessages
        };

        return {
          ...prev,
          conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
          conversationsByAgentId: {
            ...prev.conversationsByAgentId,
            [agentId]: updatedConversation
          },
          messageCountByAgentId: {
            ...prev.messageCountByAgentId,
            [agentId]: serverMessageCount
          },
          isConversationLoading: false
        };
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to load conversation';
      setState((prev) => ({ ...prev, error: message, isConversationLoading: false }));
    }
  }, [apiKey, configId]);

  // Select an agent - fetch conversation and prepare for polling
  const selectAgent = useCallback(async (id: string): Promise<void> => {
    // Clear any pending polling
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    isPollingRef.current = false;

    if (!id) {
      setState((prev) => ({
        ...prev,
        selectedAgentId: undefined,
        conversation: undefined,
        isConversationLoading: false
      }));
      return;
    }

    // Update selected agent
    setState((prev) => ({
      ...prev,
      selectedAgentId: id,
      isConversationLoading: true
    }));

    currentAgentIdRef.current = id;

    // Fetch conversation immediately (will set message count)
    await loadConversation(id, true);
  }, [loadConversation]);

  // Refresh agents list
  const refresh = useCallback(async (): Promise<void> => {
    await loadAgents();
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId, true);
    }
  }, [loadAgents, loadConversation, state.selectedAgentId]);

  // Force refresh conversation
  const refreshConversation = useCallback(async (): Promise<void> => {
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId, true);
    }
  }, [loadConversation, state.selectedAgentId]);

  // Add message to conversation (used when user sends a message)
  const addMessageToConversation = useCallback((agentId: string, message: {
    type: string;
    text: string;
    id?: string;
    createdAt?: string;
  }): void => {
    setState((prev) => {
      const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
      const existingMessages = currentConversation?.messages ?? [];

      // Create temp message
      const tempMessage = {
        ...message,
        id: message.id ?? `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: message.createdAt ?? new Date().toISOString()
      };

      // Check for duplicates
      const exists = existingMessages.some(m =>
        m.id === tempMessage.id ||
        (m.text === tempMessage.text && m.type === tempMessage.type)
      );

      if (exists) {
        return prev;
      }

      const updatedMessages = [...existingMessages, tempMessage];
      const updatedConversation: CursorConversationResponse = {
        ...currentConversation,
        messages: updatedMessages
      };

      // Update agent status to RUNNING
      const updatedAgents = prev.agents.map((agent) => {
        if (agent.id === agentId && agent.status !== 'RUNNING') {
          return { ...agent, status: 'RUNNING' as const };
        }
        return agent;
      });

      // Update message count
      const newCount = (prev.messageCountByAgentId[agentId] ?? existingMessages.length) + 1;

      return {
        ...prev,
        agents: updatedAgents,
        conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
        conversationsByAgentId: {
          ...prev.conversationsByAgentId,
          [agentId]: updatedConversation
        },
        messageCountByAgentId: {
          ...prev.messageCountByAgentId,
          [agentId]: newCount
        }
      };
    });
  }, []);

  // Mark all messages as read (resets tracking to current count)
  const markAllMessagesRead = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      messageCountByAgentId: {
        ...prev.messageCountByAgentId,
        [prev.selectedAgentId ?? '']: (prev.conversation?.messages ?? []).length
      }
    }));
  }, []);

  // Load agents and user info on mount
  useEffect(() => {
    void loadUserInfo();
    void loadAgents();
  }, [configId, apiKey, loadUserInfo, loadAgents]);

  // Polling effect - only when agent is RUNNING
  useEffect(() => {
    if (!state.selectedAgentId || !conversationPollIntervalMs) {
      return;
    }

    const agentId = state.selectedAgentId;

    // Check if agent is running
    const agent = state.agents.find(a => a.id === agentId);
    if (agent?.status !== 'RUNNING') {
      return;
    }

    // Start polling for this agent
    isPollingRef.current = true;
    currentAgentIdRef.current = agentId;

    const pollInterval = conversationPollIntervalMs;

    const poll = async () => {
      // Verify we should still be polling
      if (!isPollingRef.current || currentAgentIdRef.current !== agentId) {
        return;
      }

      // Check if agent is still running
      let stillRunning = false;
      setState((prev) => {
        const currentAgent = prev.agents.find(a => a.id === agentId);
        stillRunning = currentAgent?.status === 'RUNNING';
        if (!stillRunning) {
          isPollingRef.current = false;
        }
        return prev;
      });

      if (!stillRunning || !isPollingRef.current) {
        return;
      }

      // Fetch and add only NEW messages (isInitialLoad = false)
      await loadConversation(agentId, false);

      // Schedule next poll only if still polling
      if (isPollingRef.current && currentAgentIdRef.current === agentId) {
        pollTimeoutRef.current = setTimeout(poll, pollInterval);
      }
    };

    // Start polling
    pollTimeoutRef.current = setTimeout(poll, pollInterval);

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      isPollingRef.current = false;
    };
  }, [state.selectedAgentId, state.agents.length, conversationPollIntervalMs, loadConversation]);

  return {
    state,
    selectAgent,
    refresh,
    refreshConversation,
    addMessageToConversation,
    markAllMessagesRead
  };
}
