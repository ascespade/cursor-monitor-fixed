/**
 * useCloudAgents
 *
 * Purpose:
 * - Manage the list of Cursor Cloud Agents and the currently selected agent
 *   for the dashboard, including basic polling.
 */
'use client';

import { useEffect, useState } from 'react';

import type { CursorAgent, CursorConversationResponse } from '@/features/cloud-agents/types';
import {
  fetchCloudAgents,
  fetchCloudAgentConversation,
  fetchCloudAgentUserInfo
} from '@/features/cloud-agents/services/cloud-agents.service';

interface UseCloudAgentsOptions {
  configId?: string;
  apiKey?: string; // API key from localStorage (takes priority over configId)
  pollIntervalMs?: number; // Polling interval for agents list (default: undefined = no polling)
  conversationPollIntervalMs?: number; // Polling interval for conversation (default: 3000ms = 3 seconds)
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
}

export function useCloudAgents(options: UseCloudAgentsOptions = {}): {
  state: UseCloudAgentsState;
  selectAgent: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshConversation: () => Promise<void>;
  addMessageToConversation: (agentId: string, message: { type: string; text: string; id?: string; createdAt?: string }) => void;
} {
  const [state, setState] = useState<UseCloudAgentsState>({
    agents: [],
    conversationsByAgentId: {},
    loading: false,
    userInfoLoading: false
  });

  const { configId, apiKey, pollIntervalMs, conversationPollIntervalMs = 3000 } = options;

  const loadUserInfo = async (): Promise<void> => {
    // Skip loading user info if no API key is provided
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
  };

  const loadAgents = async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const data = await fetchCloudAgents({ apiKey, configId, limit: 50 });
      setState((prev) => ({ ...prev, agents: data.agents ?? [], loading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agents';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const loadConversation = async (agentId: string, silent = false): Promise<void> => {
    try {
      const data = await fetchCloudAgentConversation(agentId, apiKey ? { apiKey } : { configId });
      setState((prev) => {
        const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
        const currentMessages = currentConversation?.messages ?? [];
        const newMessages = data.messages ?? [];
        
        // Merge messages by ID (canonical store pattern)
        // Create a Map keyed by message ID for O(1) lookup
        const messageMap = new Map<string, any>();
        
        // First, add all current messages to the map (preserve temp messages)
        currentMessages.forEach((msg) => {
          const msgId = msg.id || `temp-${msg.text}-${(msg as { createdAt?: string })['createdAt']}`;
          messageMap.set(msgId, msg);
        });
        
        // Then, merge new messages from server
        newMessages.forEach((msg) => {
          const msgId = msg.id || `temp-${msg.text}-${(msg as { createdAt?: string })['createdAt']}`;
          const existingMsg = messageMap.get(msgId);
          
          // If message exists with same ID, update it
          if (existingMsg) {
            // If existing is temp and new is real, replace temp with real
            if (existingMsg.id?.startsWith('temp-') && msg.id && !msg.id.startsWith('temp-')) {
              messageMap.set(msgId, msg);
            } else if (!existingMsg.id?.startsWith('temp-') && msg.id && !msg.id.startsWith('temp-')) {
              // Both are real messages, use the one with latest timestamp
              const existingTime = existingMsg.createdAt ? new Date(existingMsg.createdAt).getTime() : 0;
              const msgCreatedAt = (msg as { createdAt?: string })['createdAt'];
              const newTime = msgCreatedAt && typeof msgCreatedAt === 'string'
                ? new Date(msgCreatedAt).getTime() 
                : 0;
              
              if (newTime >= existingTime) {
                messageMap.set(msgId, msg);
              }
            }
            // Otherwise keep existing (don't replace temp with temp, or real with temp)
          } else {
            // New message from server, add it
            messageMap.set(msgId, msg);
          }
        });
        
        // Remove temp messages that match real messages by text (same text = same message)
        // This handles the case where temp message has different ID than real message
        const tempMessages = Array.from(messageMap.entries()).filter(([_, msg]) => msg.id?.startsWith('temp-'));
        const realMessages = Array.from(messageMap.values()).filter(msg => msg.id && !msg.id.startsWith('temp-'));
        
        tempMessages.forEach(([tempId, tempMsg]) => {
          // Find matching real message by text content
          const matchingReal = realMessages.find((realMsg) => {
            return tempMsg.text === realMsg.text && tempMsg.type === realMsg.type;
          });
          
          // If we found a matching real message, remove the temp one
          if (matchingReal) {
            messageMap.delete(tempId);
          }
        });
        
        // Convert map back to sorted array (by createdAt)
        const mergedMessages = Array.from(messageMap.values()).sort((a, b) => {
          const aCreatedAt = (a as { createdAt?: string })['createdAt'];
          const aTime = aCreatedAt && typeof aCreatedAt === 'string'
            ? new Date(aCreatedAt).getTime() 
            : 0;
          const bCreatedAt = (b as { createdAt?: string })['createdAt'];
          const bTime = bCreatedAt && typeof bCreatedAt === 'string'
            ? new Date(bCreatedAt).getTime() 
            : 0;
          return aTime - bTime;
        });
        
        // Only update if messages actually changed
        const hasChanges = mergedMessages.length !== currentMessages.length ||
          mergedMessages.some((msg, idx) => {
            const currentMsg = currentMessages[idx];
            if (!currentMsg) return true;
            return msg.id !== currentMsg.id || msg.text !== currentMsg.text;
          });
        
        if (!hasChanges && silent) {
          return prev; // No changes, skip update
        }
        
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
          }
        };
      });
    } catch (error) {
      // Only show error if not silent polling
      if (!silent) {
        const message = error instanceof Error ? error.message : 'Failed to load conversation';
        setState((prev) => ({ ...prev, error: message }));
      }
    }
  };

  const selectAgent = async (id: string): Promise<void> => {
    if (!id) {
      // Clear agent selection and conversation
      setState((prev) => ({
        ...prev,
        selectedAgentId: undefined,
        conversation: undefined
      }));
      return;
    }
    setState((prev) => ({
      ...prev,
      selectedAgentId: id,
      conversation: prev.conversationsByAgentId[id] ?? prev.conversation
    }));
    await loadConversation(id);
  };

  const refresh = async (): Promise<void> => {
    await loadAgents();
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId);
    }
  };

  const refreshConversation = async (): Promise<void> => {
    if (state.selectedAgentId) {
      await loadConversation(state.selectedAgentId, false);
    }
  };

  const addMessageToConversation = (agentId: string, message: { type: string; text: string; id?: string; createdAt?: string }): void => {
    setState((prev) => {
      const currentConversation = prev.conversationsByAgentId[agentId] ?? prev.conversation;
      const newMessage = {
        ...message,
        id: message.id ?? `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: message.createdAt ?? new Date().toISOString()
      };
      
      // Prevent duplicate messages by checking if message already exists
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
      return {
        ...prev,
        conversation: agentId === prev.selectedAgentId ? updatedConversation : prev.conversation,
        conversationsByAgentId: {
          ...prev.conversationsByAgentId,
          [agentId]: updatedConversation
        }
      };
    });
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId, apiKey, pollIntervalMs]);

  // Poll conversation when agent is selected and poll interval is set
  useEffect(() => {
    if (!state.selectedAgentId || !conversationPollIntervalMs || conversationPollIntervalMs <= 0) {
      return;
    }

    // Find the selected agent to check its status
    const selectedAgent = state.agents.find((a) => a.id === state.selectedAgentId);
    const isRunning = selectedAgent?.status === 'RUNNING';
    const isFinished = selectedAgent?.status === 'FINISHED';
    const isError = selectedAgent?.status === 'ERROR';

    // Poll if agent is running, or if it just finished (to catch final messages)
    // Also poll for a short time after agent stops to catch any final messages
    if (!isRunning && !isFinished && !isError) {
      return;
    }

    // For finished/error agents, poll less frequently (every 10 seconds) for a limited time
    const pollInterval = isRunning ? conversationPollIntervalMs : 10000;
    let pollCount = 0;
    const maxPollCount = isRunning ? Infinity : 6; // Poll finished agents for 1 minute max

    const conversationInterval = window.setInterval(() => {
      if (state.selectedAgentId) {
        pollCount++;
        if (pollCount > maxPollCount) {
          window.clearInterval(conversationInterval);
          return;
        }
        void loadConversation(state.selectedAgentId, true); // silent = true for polling
      }
    }, pollInterval);

    return () => {
      window.clearInterval(conversationInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedAgentId, state.agents, conversationPollIntervalMs, configId, apiKey]);

  return { state, selectAgent, refresh, refreshConversation, addMessageToConversation };
}
