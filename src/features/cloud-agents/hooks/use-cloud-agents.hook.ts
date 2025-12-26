/**
 * useCloudAgents - Real-time Agent Monitoring
 *
 * Features:
 * - Fast initial load with recent messages
 * - Pagination for loading older messages
 * - Real-time polling for new messages
 * - Agent activity logs panel
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

interface AgentLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'action';
  message: string;
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
  // Pagination state
  oldestMessageId?: string;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  // Agent activity logs
  agentLogs: AgentLog[];
}

export function useCloudAgents(options: UseCloudAgentsOptions = {}): {
  state: UseCloudAgentsState;
  selectAgent: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshConversation: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  addMessageToConversation: (agentId: string, message: { type: string; text: string; id?: string; createdAt?: string }) => void;
  markAllMessagesRead: () => void;
  clearAgentLogs: () => void;
} {
  const [state, setState] = useState<UseCloudAgentsState>({
    agents: [],
    conversationsByAgentId: {},
    loading: false,
    userInfoLoading: false,
    hasMoreMessages: true,
    isLoadingMore: false,
    agentLogs: [],
    isConversationLoading: false
  });

  const { configId, apiKey, pollIntervalMs, conversationPollIntervalMs = 3000 } = options;

  // Refs for polling management
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef<boolean>(false);
  const currentAgentIdRef = useRef<string>('');

  // Helper to add log
  const addLog = useCallback((agentId: string, type: AgentLog['type'], message: string): void => {
    setState((prev) => ({
      ...prev,
      agentLogs: [
        {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          type,
          message
        },
        ...prev.agentLogs.slice(0, 99)
      ]
    }));
  }, []);

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
      
      // Check for status changes and log them
      setState((prev) => {
        const newLogs = [...prev.agentLogs];
        data.agents?.forEach((agent) => {
          const oldStatus = prev.agents.find(a => a.id === agent.id)?.status;
          if (oldStatus && oldStatus !== agent.status) {
            newLogs.unshift({
              id: `status-${Date.now()}`,
              timestamp: new Date().toISOString(),
              type: agent.status === 'RUNNING' ? 'success' : 'info',
              message: `Agent "${agent.name ?? agent.id}" status: ${oldStatus} → ${agent.status}`
            });
          }
        });
        return { ...prev, agents: data.agents ?? [], loading: false, agentLogs: newLogs };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agents';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [apiKey, configId]);

  // Load conversation for an agent - optimized for fast initial load
  const loadConversation = useCallback(async (agentId: string, options?: { 
    forceFresh?: boolean; 
    appendOlder?: boolean;
  }): Promise<void> => {
    const { forceFresh = false, appendOlder = false } = options || {};

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

        // If loading older messages, prepend unique ones to existing messages
        if (appendOlder && currentMessages.length > 0) {
          const existingIds = new Set(currentMessages.map(m => m.id).filter(Boolean));
          const olderMessages = serverMessages
            .filter(m => !m.id || !existingIds.has(m.id))
            .reverse(); // Oldest first

          if (olderMessages.length === 0) {
            return { ...prev, hasMoreMessages: false, isLoadingMore: false };
          }

          const updatedMessages = [...olderMessages, ...currentMessages];
          const updatedConversation: CursorConversationResponse = {
            ...currentConversation,
            messages: updatedMessages
          };

          addLog(agentId, 'info', `Loaded ${olderMessages.length} older messages`);

          return {
            ...prev,
            conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
            conversationsByAgentId: {
              ...prev.conversationsByAgentId,
              [agentId]: updatedConversation
            },
            oldestMessageId: olderMessages[0]?.id,
            hasMoreMessages: true, // Keep trying until we get no more
            isLoadingMore: false,
            isConversationLoading: false
          };
        }

        // Normal load - replace messages
        const updatedConversation: CursorConversationResponse = {
          ...data,
          messages: serverMessages
        };

        // Log message count on initial load
        if (agentId === prev.selectedAgentId && prev.conversation?.messages === undefined) {
          addLog(agentId, 'info', `${serverMessageCount} messages loaded`);
        } else if (agentId === prev.selectedAgentId && serverMessageCount !== currentMessages.length) {
          const diff = serverMessageCount - currentMessages.length;
          addLog(agentId, diff > 0 ? 'action' : 'info', 
            diff > 0 
              ? `${diff} new message${diff > 1 ? 's' : ''} (${serverMessageCount} total)`
              : `Messages: ${serverMessageCount}`
          );
        }

        return {
          ...prev,
          conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
          conversationsByAgentId: {
            ...prev.conversationsByAgentId,
            [agentId]: updatedConversation
          },
          oldestMessageId: serverMessages[0]?.id,
          hasMoreMessages: true,
          isLoadingMore: false,
          isConversationLoading: false
        };
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to load conversation';
      setState((prev) => ({ ...prev, error: message, isConversationLoading: false, isLoadingMore: false }));
    }
  }, [apiKey, configId, addLog]);

  // Load older messages for pagination
  const loadOlderMessages = useCallback(async (): Promise<void> => {
    const agentId = state.selectedAgentId;
    if (!agentId || !state.conversation?.messages || state.isLoadingMore) {
      return;
    }

    setState((prev) => ({ ...prev, isLoadingMore: true }));

    // For pagination, reload all messages and filter out ones we already have
    await loadConversation(agentId, { appendOlder: true });
  }, [state.selectedAgentId, state.conversation?.messages, state.isLoadingMore, loadConversation]);

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
        isConversationLoading: false,
        hasMoreMessages: true,
        isLoadingMore: false,
        oldestMessageId: undefined
      }));
      return;
    }

    // Update selected agent
    setState((prev) => ({
      ...prev,
      selectedAgentId: id,
      isConversationLoading: true,
      hasMoreMessages: true,
      isLoadingMore: false,
      oldestMessageId: undefined
    }));

    currentAgentIdRef.current = id;

    addLog(id, 'info', 'Opening conversation...');
    
    // Force fresh load when selecting - FAST
    await loadConversation(id, { forceFresh: true });
    
    // Mark as polling now
    isPollingRef.current = true;
  }, [loadConversation, addLog]);

  // Refresh agents list
  const refresh = useCallback(async (): Promise<void> => {
    await loadAgents();
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId, { forceFresh: true });
    }
  }, [loadAgents, loadConversation, state.selectedAgentId]);

  // Force refresh conversation
  const refreshConversation = useCallback(async (): Promise<void> => {
    if (state.selectedAgentId) {
      addLog(state.selectedAgentId, 'info', 'Refreshing conversation...');
      await loadConversation(state.selectedAgentId, { forceFresh: true });
    }
  }, [loadConversation, state.selectedAgentId, addLog]);

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

      return {
        ...prev,
        agents: updatedAgents,
        conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
        conversationsByAgentId: {
          ...prev.conversationsByAgentId,
          [agentId]: updatedConversation
        }
      };
    });
  }, []);

  // Clear agent logs
  const clearAgentLogs = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      agentLogs: []
    }));
  }, []);

  // Mark all messages as read (legacy - kept for compatibility)
  const markAllMessagesRead = useCallback((): void => {
    // No-op in new implementation
  }, []);

  // Load agents and user info on mount
  useEffect(() => {
    void loadUserInfo();
    void loadAgents();
  }, [configId, apiKey, loadUserInfo, loadAgents]);

  // Polling effect - runs continuously when agent is selected
  useEffect(() => {
    if (!state.selectedAgentId || !conversationPollIntervalMs) {
      return;
    }

    const agentId = state.selectedAgentId;

    const pollInterval = conversationPollIntervalMs;

    const poll = async () => {
      // Verify we should still be polling
      if (!isPollingRef.current || currentAgentIdRef.current !== agentId) {
        return;
      }

      // Check if agent is still selected
      let isStillSelected = false;
      setState((prev) => {
        isStillSelected = prev.selectedAgentId === agentId;
        if (!isStillSelected) {
          isPollingRef.current = false;
        }
        return prev;
      });

      if (!isStillSelected || !isPollingRef.current) {
        return;
      }

      // Fetch fresh conversation data
      await loadConversation(agentId, { forceFresh: false });

      // Schedule next poll
      if (isPollingRef.current && currentAgentIdRef.current === agentId) {
        pollTimeoutRef.current = setTimeout(poll, pollInterval);
      }
    };

    // Start polling immediately
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
  }, [state.selectedAgentId, state.agents, conversationPollIntervalMs, loadConversation]);

  return {
    state,
    selectAgent,
    refresh,
    refreshConversation,
    loadOlderMessages,
    addMessageToConversation,
    markAllMessagesRead,
    clearAgentLogs
  };
}
