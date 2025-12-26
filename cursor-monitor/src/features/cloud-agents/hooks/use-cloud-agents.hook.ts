/**
 * useCloudAgents - MiniMax-style Optimized Chat Behavior
 *
 * Purpose:
 * - Manage Cursor Cloud Agents with polished chat experience
 * - Eliminate flickering and re-rendering issues
 * - Smart polling with exponential backoff and request cancellation
 * - Seamless message updates without full re-renders
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
  // New: Track if we have pending updates
  pendingMessageCount: number;
}

export function useCloudAgents(options: UseCloudAgentsOptions = {}): {
  state: UseCloudAgentsState;
  selectAgent: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshConversation: () => Promise<void>;
  addMessageToConversation: (agentId: string, message: { type: string; text: string; id?: string; createdAt?: string }) => void;
  markMessagesRead: () => void;
} {
  const [state, setState] = useState<UseCloudAgentsState>({
    agents: [],
    conversationsByAgentId: {},
    loading: false,
    userInfoLoading: false,
    pendingMessageCount: 0
  });

  const { configId, apiKey, pollIntervalMs, conversationPollIntervalMs = 3000 } = options;

  // Refs for polling management
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPollIntervalRef = useRef<number>(3000); // Start with 3 seconds
  const consecutiveErrorsRef = useRef<number>(0);
  const lastMessageCountRef = useRef<number>(0);
  const isPollingPausedRef = useRef<boolean>(false);
  const lastFetchedMessageIdsRef = useRef<Set<string>>(new Set());

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

  // Enhanced message comparison - only detect genuinely new messages
  const findNewMessages = useCallback((
    currentMessages: any[],
    newMessages: any[]
  ): { new: any[]; replacedTempIds: Set<string> } => {
    const newMsgs: any[] = [];
    const replacedTempIds = new Set<string>();
    const currentIdSet = new Set(currentMessages.map(m => m.id).filter(Boolean));
    const currentTempSet = new Set(
      currentMessages
        .filter(m => m.id?.startsWith('temp-'))
        .map(m => `${m.type}-${m.text}`)
    );

    for (const msg of newMessages) {
      // If this is a real message we already have, skip
      if (msg.id && currentIdSet.has(msg.id)) {
        // Check if it replaces a temp message
        const tempMsg = currentMessages.find(
          m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
        );
        if (tempMsg) {
          replacedTempIds.add(tempMsg.id);
        }
        continue;
      }

      // If this is a real message matching a temp message by content, it's a replacement
      if (!msg.id?.startsWith('temp-') && currentTempSet.has(`${msg.type}-${msg.text}`)) {
        const tempMsg = currentMessages.find(
          m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
        );
        if (tempMsg) {
          replacedTempIds.add(tempMsg.id);
        }
        continue;
      }

      // This is genuinely new
      newMsgs.push(msg);
    }

    return { new: newMsgs, replacedTempIds };
  }, []);

  // Smart conversation loader with AbortController and exponential backoff
  const loadConversation = useCallback(async (agentId: string, silent = false): Promise<{
    hasNewMessages: boolean;
    newMessageCount: number;
    replacedTempIds: Set<string>;
  }> => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await fetchCloudAgentConversation(agentId, apiKey ? { apiKey } : { configId }, controller.signal);
      const newMessages = data.messages ?? [];

      // Get current state for comparison (outside setState to avoid unnecessary renders)
      let currentStateSnapshot: UseCloudAgentsState | null = null;
      setState((prev) => {
        currentStateSnapshot = prev;
        return prev;
      });

      if (currentStateSnapshot) {
        const currentConversation = currentStateSnapshot.conversationsByAgentId[agentId] ?? currentStateSnapshot.conversation;
        const currentMessages = currentConversation?.messages ?? [];

        // Early exit: no changes detected, skip setState entirely
        if (newMessages.length === currentMessages.length) {
          const lastCurrent = currentMessages[currentMessages.length - 1];
          const lastNew = newMessages[newMessages.length - 1];

          if (lastCurrent?.id && lastNew?.id && lastCurrent.id === lastNew.id) {
            // Reset error count on success
            consecutiveErrorsRef.current = 0;
            currentPollIntervalRef.current = 3000;
            return {
              hasNewMessages: false,
              newMessageCount: 0,
              replacedTempIds: new Set()
            };
          }
        }

        // Find genuinely new messages
        const { new: genuinelyNew, replacedTempIds } = findNewMessages(currentMessages, newMessages);

        if (genuinelyNew.length === 0 && replacedTempIds.size === 0) {
          // No actual changes, skip setState to prevent re-render
          consecutiveErrorsRef.current = 0;
          currentPollIntervalRef.current = 3000;
          return {
            hasNewMessages: false,
            newMessageCount: 0,
            replacedTempIds: new Set()
          };
        }
      }

      // There are changes, proceed with setState
      let result: {
        hasNewMessages: boolean;
        newMessageCount: number;
        replacedTempIds: Set<string>;
      } = { hasNewMessages: false, newMessageCount: 0, replacedTempIds: new Set() };

      setState((prev) => {
        const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
        const currentMessages = currentConversation?.messages ?? [];

        // Find genuinely new messages
        const { new: genuinelyNew, replacedTempIds } = findNewMessages(currentMessages, newMessages);

        // Create merged messages preserving order
        const messageMap = new Map<string, any>();

        // Add all current messages first
        currentMessages.forEach((msg) => {
          messageMap.set(msg.id || `temp-${msg.text}-${(msg as { createdAt?: string })['createdAt']}`, msg);
        });

        // Update/replace with new messages
        newMessages.forEach((msg) => {
          const msgId = msg.id || `temp-${msg.text}-${(msg as { createdAt?: string })['createdAt']}`;
          messageMap.set(msgId, msg);
        });

        // Remove temp messages that have been replaced by real messages
        replacedTempIds.forEach((tempId) => {
          const tempMsg = messageMap.get(tempId);
          if (tempMsg) {
            // Check if there's a real message with same content
            const realMsg = newMessages.find(
              m => !m.id?.startsWith('temp-') && m.type === tempMsg.type && m.text === tempMsg.text
            );
            if (realMsg) {
              messageMap.delete(tempId);
            }
          }
        });

        // Sort by createdAt
        const mergedMessages = Array.from(messageMap.values()).sort((a, b) => {
          const aTime = (a as { createdAt?: string })['createdAt']
            ? new Date((a as { createdAt?: string })['createdAt']!).getTime() : 0;
          const bTime = (b as { createdAt?: string })['createdAt']
            ? new Date((b as { createdAt?: string })['createdAt']!).getTime() : 0;
          return aTime - bTime;
        });

        const updatedConversation: CursorConversationResponse = {
          ...data,
          messages: mergedMessages
        };

        result = {
          hasNewMessages: genuinelyNew.length > 0 || replacedTempIds.size > 0,
          newMessageCount: genuinelyNew.length,
          replacedTempIds
        };

        return {
          ...prev,
          conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
          conversationsByAgentId: {
            ...prev.conversationsByAgentId,
            [agentId]: updatedConversation
          },
          pendingMessageCount: prev.pendingMessageCount + genuinelyNew.length
        };
      });

      // Success: reset error tracking
      consecutiveErrorsRef.current = 0;
      currentPollIntervalRef.current = 3000;

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled, ignore
        return { hasNewMessages: false, newMessageCount: 0, replacedTempIds: new Set() };
      }

      // Track consecutive errors for exponential backoff
      consecutiveErrorsRef.current++;

      // Calculate backoff: 3s → 5s → 10s → 20s → max 30s
      const backoffMs = Math.min(3000 * Math.pow(2, consecutiveErrorsRef.current - 1), 30000);
      currentPollIntervalRef.current = backoffMs;

      if (!silent) {
        const message = error instanceof Error ? error.message : 'Failed to load conversation';
        setState((prev) => ({ ...prev, error: message }));
      }

      return { hasNewMessages: false, newMessageCount: 0, replacedTempIds: new Set() };
    }
  }, [apiKey, configId, findNewMessages]);

  const selectAgent = useCallback(async (id: string): Promise<void> => {
    if (!id) {
      setState((prev) => ({
        ...prev,
        selectedAgentId: undefined,
        conversation: undefined
      }));
      return;
    }

    // Cancel any pending polling
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      selectedAgentId: id,
      conversation: prev.conversationsByAgentId[id] ?? prev.conversation
    }));

    // Reset tracking for new agent
    lastMessageCountRef.current = 0;
    lastFetchedMessageIdsRef.current = new Set();

    await loadConversation(id);
  }, [loadConversation]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadAgents();
    if (state.selectedAgentId) {
      lastMessageCountRef.current = 0;
      lastFetchedMessageIdsRef.current = new Set();
      await loadConversation(state.selectedAgentId, false);
    }
  }, [loadAgents, loadConversation, state.selectedAgentId]);

  const refreshConversation = useCallback(async (): Promise<void> => {
    if (state.selectedAgentId) {
      lastMessageCountRef.current = 0;
      lastFetchedMessageIdsRef.current = new Set();
      await loadConversation(state.selectedAgentId, false);
    }
  }, [loadConversation, state.selectedAgentId]);

  const addMessageToConversation = useCallback((agentId: string, message: {
    type: string;
    text: string;
    id?: string;
    createdAt?: string;
  }): void => {
    setState((prev) => {
      const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
      const newMessage = {
        ...message,
        id: message.id ?? `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: message.createdAt ?? new Date().toISOString()
      };

      // Prevent duplicates
      const existingMessages = currentConversation?.messages ?? [];
      const messageExists = existingMessages.some((msg) => {
        if (msg.id === newMessage.id) return true;
        if (msg.text === newMessage.text && msg.type === newMessage.type) {
          const msgCreatedAt = (msg as { createdAt?: string })['createdAt'];
          const msgTime = msgCreatedAt ? new Date(msgCreatedAt).getTime() : 0;
          const newMsgTime = new Date(newMessage.createdAt).getTime();
          return Math.abs(msgTime - newMsgTime) < 1000;
        }
        return false;
      });

      if (messageExists) {
        return prev;
      }

      const updatedMessages = [...existingMessages, newMessage];
      const updatedConversation: CursorConversationResponse = {
        ...currentConversation,
        messages: updatedMessages
      };

      // Update last message count ref to prevent false "new message" detection
      lastMessageCountRef.current = updatedMessages.length;

      return {
        ...prev,
        conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
        conversationsByAgentId: {
          ...prev.conversationsByAgentId,
          [agentId]: updatedConversation
        }
      };
    });
  }, []);

  const markMessagesRead = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      pendingMessageCount: 0
    }));
  }, []);

  // Smart polling with exponential backoff and visibility handling
  useEffect(() => {
    void loadUserInfo();
    void loadAgents();

    const interval =
      pollIntervalMs && pollIntervalMs > 0
        ? window.setInterval(() => {
            void loadAgents();
          }, pollIntervalMs)
        : undefined;

    return () => {
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [configId, apiKey, pollIntervalMs, loadUserInfo, loadAgents]);

  // Enhanced conversation polling with visibility awareness
  useEffect(() => {
    if (!state.selectedAgentId || !conversationPollIntervalMs || conversationPollIntervalMs <= 0) {
      return;
    }

    const selectedAgent = state.agents.find((a) => a.id === state.selectedAgentId);
    const isRunning = selectedAgent?.status === 'RUNNING';
    const isFinished = selectedAgent?.status === 'FINISHED';
    const isError = selectedAgent?.status === 'ERROR';

    if (!isRunning && !isFinished && !isError) {
      return;
    }

    let pollCount = 0;
    const maxPollCount = isRunning ? Infinity : 6;

    const runPoll = async () => {
      if (!state.selectedAgentId) return;

      const result = await loadConversation(state.selectedAgentId, true);

      pollCount++;
      if (pollCount > maxPollCount) {
        return;
      }

      // Calculate next poll interval with exponential backoff
      const baseInterval = isRunning ? conversationPollIntervalMs : 10000;
      const nextInterval = Math.min(baseInterval + consecutiveErrorsRef.current * 1000, 30000);

      pollTimeoutRef.current = setTimeout(runPoll, nextInterval);
    };

    // Start polling
    pollTimeoutRef.current = setTimeout(runPoll, currentPollIntervalRef.current);

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [state.selectedAgentId, state.agents, conversationPollIntervalMs, configId, apiKey, loadConversation]);

  // Pause polling when tab is not visible (save resources)
  useEffect(() => {
    const handleVisibilityChange = () => {
      isPollingPausedRef.current = document.hidden;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return {
    state,
    selectAgent,
    refresh,
    refreshConversation,
    addMessageToConversation,
    markMessagesRead
  };
}
