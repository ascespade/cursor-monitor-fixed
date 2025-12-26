/**
 * useCloudAgents - Simplified Chat Behavior System
 *
 * Purpose:
 * - Clean, predictable chat experience
 * - When opening chat: fetch messages and scroll to last message
 * - When sending message: add automatically to chat
 * - When agent RUNNING: poll for new messages in background and add them
 * - Simple tracking - no confusing "new messages" count
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
  // Simple message tracking - only track which messages we received in current session
  lastKnownMessageIds: Set<string>;
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
    lastKnownMessageIds: new Set(),
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

  // Get truly new messages that should be added
  const getNewMessages = useCallback((
    currentMessages: any[],
    newMessages: any[]
  ): { newMessages: any[]; replacedTempIds: Set<string> } => {
    const newMsgs: any[] = [];
    const replacedTempIds = new Set<string>();
    const currentIds = new Set(currentMessages.map(m => m.id).filter(Boolean));

    for (const msg of newMessages) {
      // Skip if we already have this message (by ID)
      if (msg.id && currentIds.has(msg.id)) {
        // Check if this real message replaces a temp message
        const tempMsg = currentMessages.find(
          m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
        );
        if (tempMsg) {
          replacedTempIds.add(tempMsg.id);
        }
        continue;
      }

      // This is a genuinely new message
      newMsgs.push(msg);
    }

    return { newMessages: newMsgs, replacedTempIds };
  }, []);

  // Load conversation for an agent
  const loadConversation = useCallback(async (agentId: string, isInitialLoad = false): Promise<void> => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await fetchCloudAgentConversation(agentId, apiKey ? { apiKey } : { configId }, controller.signal);
      const serverMessages = data.messages ?? [];

      setState((prev) => {
        // Get current messages
        const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
        const currentMessages = currentConversation?.messages ?? [];

        // Get new messages
        const { newMessages, replacedTempIds } = getNewMessages(currentMessages, serverMessages);

        // Build merged messages array
        let mergedMessages: any[];

        if (newMessages.length === 0 && replacedTempIds.size === 0) {
          // No changes - keep current messages
          mergedMessages = currentMessages;
        } else {
          // Remove replaced temp messages
          const filteredMessages = currentMessages.filter(
            m => !(m.id && replacedTempIds.has(m.id))
          );

          // Add new messages
          mergedMessages = [...filteredMessages, ...newMessages];

          // Sort by createdAt
          mergedMessages.sort((a, b) => {
            const aTime = (a as { createdAt?: string })['createdAt']
              ? new Date((a as { createdAt?: string })['createdAt']!).getTime() : 0;
            const bTime = (b as { createdAt?: string })['createdAt']
              ? new Date((b as { createdAt?: string })['createdAt']!).getTime() : 0;
            return aTime - bTime;
          });
        }

        // Track which message IDs we know about
        const lastKnownIds = new Set(prev.lastKnownMessageIds);
        mergedMessages.forEach(m => {
          if (m.id) lastKnownIds.add(m.id);
        });

        // Update state
        const updatedConversation: CursorConversationResponse = {
          ...data,
          messages: mergedMessages
        };

        return {
          ...prev,
          conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
          conversationsByAgentId: {
            ...prev.conversationsByAgentId,
            [agentId]: updatedConversation
          },
          lastKnownMessageIds: lastKnownIds,
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
  }, [apiKey, configId, getNewMessages]);

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

    // Fetch conversation immediately
    await loadConversation(id, true);
  }, [loadConversation]);

  // Refresh agents list
  const refresh = useCallback(async (): Promise<void> => {
    await loadAgents();
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId);
    }
  }, [loadAgents, loadConversation, state.selectedAgentId]);

  // Force refresh conversation
  const refreshConversation = useCallback(async (): Promise<void> => {
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId);
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

  // Mark all messages as read (clears any tracking)
  const markAllMessagesRead = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      lastKnownMessageIds: new Set<string>(
        (prev.conversation?.messages ?? []).map(m => m.id).filter((id): id is string => Boolean(id))
      )
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
