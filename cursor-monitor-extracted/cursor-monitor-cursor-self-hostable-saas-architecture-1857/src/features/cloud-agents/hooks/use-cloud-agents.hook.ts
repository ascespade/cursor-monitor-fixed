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

  // Ref to track last conversation for comparison (avoid unnecessary re-renders)
  const lastConversationRef = useRef<CursorConversationResponse | null>(null);

  // Enhanced message comparison - only detect genuinely new messages
  const findNewMessages = useCallback((
    currentMessages: any[],
    newMessages: any[]
  ): { new: any[]; replacedTempIds: Set<string>; hasChanges: boolean } => {
    const newMsgs: any[] = [];
    const replacedTempIds = new Set<string>();

    // If lengths are different, there are definitely changes
    if (currentMessages.length !== newMessages.length) {
      const currentIds = new Set(currentMessages.map(m => m.id).filter(Boolean));
      const currentTempContent = new Set(
        currentMessages.filter(m => m.id?.startsWith('temp-')).map(m => `${m.type}-${m.text}`)
      );

      for (const msg of newMessages) {
        // Check if this is a real message we already have
        if (msg.id && currentIds.has(msg.id)) {
          const tempMsg = currentMessages.find(
            m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
          );
          if (tempMsg) replacedTempIds.add(tempMsg.id);
          continue;
        }

        // Check if real message replaces temp
        if (!msg.id?.startsWith('temp-') && currentTempContent.has(`${msg.type}-${msg.text}`)) {
          const tempMsg = currentMessages.find(
            m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
          );
          if (tempMsg) replacedTempIds.add(tempMsg.id);
          continue;
        }

        newMsgs.push(msg);
      }

      return { new: newMsgs, replacedTempIds, hasChanges: true };
    }

    // Same length - check if IDs match
    const currentIds = new Set(currentMessages.map(m => m.id).filter(Boolean));
    const newIds = new Set(newMessages.map(m => m.id).filter(Boolean));

    // If all IDs match, no changes
    if (currentIds.size === newIds.size && [...currentIds].every(id => newIds.has(id))) {
      return { new: [], replacedTempIds: new Set(), hasChanges: false };
    }

    // IDs don't match - there are changes
    const currentTempContent = new Set(
      currentMessages.filter(m => m.id?.startsWith('temp-')).map(m => `${m.type}-${m.text}`)
    );

    for (const msg of newMessages) {
      if (msg.id && currentIds.has(msg.id)) {
        const tempMsg = currentMessages.find(
          m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
        );
        if (tempMsg) replacedTempIds.add(tempMsg.id);
        continue;
      }

      if (!msg.id?.startsWith('temp-') && currentTempContent.has(`${msg.type}-${msg.text}`)) {
        const tempMsg = currentMessages.find(
          m => m.id?.startsWith('temp-') && m.type === msg.type && m.text === msg.text
        );
        if (tempMsg) replacedTempIds.add(tempMsg.id);
        continue;
      }

      newMsgs.push(msg);
    }

    return { new: newMsgs, replacedTempIds, hasChanges: newMsgs.length > 0 || replacedTempIds.size > 0 };
  }, []);

  // Smart conversation loader with AbortController and exponential backoff
  // IMPORTANT: Only call setState when there are actual changes to avoid re-renders
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

      // Get current messages from state (without triggering update)
      // We'll read this synchronously after the fetch
      let currentMessages: any[] = [];
      let currentConversationRefValue: CursorConversationResponse | undefined;

      // Use a one-time effect pattern: we'll set state only if needed
      setState((prev) => {
        currentConversationRefValue = prev.conversationsByAgentId[agentId] ?? prev.conversation;
        currentMessages = currentConversationRefValue?.messages ?? [];
        return prev; // Don't actually update here
      });

      currentMessages = currentMessages || [];

      // Check if there are any changes
      const { new: genuinelyNew, replacedTempIds, hasChanges } = findNewMessages(currentMessages, newMessages);

      // Reset error tracking on success
      consecutiveErrorsRef.current = 0;
      currentPollIntervalRef.current = 3000;

      // If no changes, don't call setState at all (prevents re-render)
      if (!hasChanges) {
        return { hasNewMessages: false, newMessageCount: 0, replacedTempIds: new Set() };
      }

      // There are changes - update state
      setState((prev) => {
        const currentConv = prev.conversationsByAgentId[agentId] ?? prev.conversation;
        const msgs = currentConv?.messages ?? [];

        // Recalculate in case state changed between our check and now
        const { new: actualNew, replacedTempIds: actualReplaced } = findNewMessages(msgs, newMessages);

        if (actualNew.length === 0 && actualReplaced.size === 0) {
          return prev; // Double-check: still no changes
        }

        // Create merged messages preserving order
        const messageMap = new Map<string, any>();

        // Add all current messages first
        msgs.forEach((msg) => {
          messageMap.set(msg.id || `temp-${msg.text}-${(msg as { createdAt?: string })['createdAt']}`, msg);
        });

        // Update/replace with new messages
        newMessages.forEach((msg) => {
          const msgId = msg.id || `temp-${msg.text}-${(msg as { createdAt?: string })['createdAt']}`;
          messageMap.set(msgId, msg);
        });

        // Remove temp messages that have been replaced by real messages
        actualReplaced.forEach((tempId) => {
          const tempMsg = messageMap.get(tempId);
          if (tempMsg) {
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

        return {
          ...prev,
          conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
          conversationsByAgentId: {
            ...prev.conversationsByAgentId,
            [agentId]: updatedConversation
          },
          pendingMessageCount: prev.pendingMessageCount + actualNew.length
        };
      });

      return {
        hasNewMessages: genuinelyNew.length > 0 || replacedTempIds.size > 0,
        newMessageCount: genuinelyNew.length,
        replacedTempIds
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { hasNewMessages: false, newMessageCount: 0, replacedTempIds: new Set() };
      }

      // Track consecutive errors for exponential backoff
      consecutiveErrorsRef.current++;
      currentPollIntervalRef.current = Math.min(3000 * Math.pow(2, consecutiveErrorsRef.current - 1), 30000);

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

    // Use ref to track current selected agent without causing re-renders
    const currentAgentId = state.selectedAgentId;

    // Find the selected agent using a ref-like approach to avoid deps changes
    const selectedAgent = state.agents.find((a) => a.id === currentAgentId);
    const isRunning = selectedAgent?.status === 'RUNNING';
    const isFinished = selectedAgent?.status === 'FINISHED';
    const isError = selectedAgent?.status === 'ERROR';

    if (!isRunning && !isFinished && !isError) {
      return;
    }

    let pollCount = 0;
    const maxPollCount = isRunning ? Infinity : 6;

    const runPoll = async () => {
      if (!state.selectedAgentId || state.selectedAgentId !== currentAgentId) return;

      const result = await loadConversation(state.selectedAgentId, true);

      // Only increment poll count if we actually got new messages
      if (result.hasNewMessages) {
        pollCount = 0; // Reset on new messages
      } else {
        pollCount++;
      }

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
  }, [state.selectedAgentId, conversationPollIntervalMs, configId, apiKey, loadConversation]);

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
