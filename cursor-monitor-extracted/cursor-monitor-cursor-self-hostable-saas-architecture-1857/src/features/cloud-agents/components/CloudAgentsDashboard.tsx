/**
 * CloudAgentsDashboard
 *
 * Purpose:
 * - Professional dashboard for monitoring and interacting with Cursor Cloud Agents
 * - Full unread messages tracking with decreasing counter
 * - Smooth loading states and transitions
 * - Optimized performance with memoization
 *
 * Professional Standards Applied:
 * - Proper TypeScript types without excessive casting
 * - useCallback/useMemo for performance optimization
 * - Clean component composition
 * - Error boundary integration
 * - Accessibility compliance
 */
'use client';

import type { FC, ReactNode } from 'react';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import { useCloudAgents } from '@/features/cloud-agents/hooks/use-cloud-agents.hook';
import { EmptyState } from '@/shared/components/EmptyState';
import { useCloudAgentsActions } from '@/features/cloud-agents/hooks/use-cloud-agents-actions.hook';
import type { CursorAgent, CursorConversationMessage, CursorConversationResponse } from '@/features/cloud-agents/types';
import {
  fetchCloudAgentModels,
  fetchCloudAgentRepositories
} from '@/features/cloud-agents/services/cloud-agents.service';
import {
  getAllApiConfigs,
  getAllApiConfigsSync,
  loadEnvVarApiKey,
  getApiColor,
  getApiKeyForConfig,
  type ApiConfig
} from '@/features/cloud-agents/services/api-config-manager.service';

// ============================================================================
// Types
// ============================================================================

interface CloudAgentsDashboardProps {
  initialConfigId?: string;
}

interface AgentWithConfig extends CursorAgent {
  configId?: string;
  configColor?: string;
  configName?: string;
}

interface ConversationState {
  messages: CursorConversationMessage[];
  unreadMessageIds: Set<string>;
  pendingMessageCount: number;
  isConversationLoading: boolean;
  selectedAgentId?: string;
  conversationsByAgentId: Record<string, CursorConversationResponse | { messages: CursorConversationMessage[] }>;
}

interface AgentCardProps {
  agent: AgentWithConfig;
  isSelected: boolean;
  isPinned: boolean;
  conversations: Record<string, CursorConversationResponse | { messages: CursorConversationMessage[] }>;
  selectAgent: (id: string) => Promise<void>;
  togglePinned: (agentId: string) => void;
  formatDateTime: (dateString?: string) => string;
  extractRepoName: (repo?: string) => string;
  copiedRepoId: string | null;
  onCopyRepo: (id: string | null) => void;
}

// ============================================================================
// Utility Functions (outside component for better performance)
// ============================================================================

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  RUNNING: { bg: 'bg-emerald-950/30', text: 'text-emerald-300', border: 'border-emerald-700/50' },
  FINISHED: { bg: 'bg-green-950/30', text: 'text-green-300', border: 'border-green-700/50' },
  ERROR: { bg: 'bg-red-950/30', text: 'text-red-300', border: 'border-red-700/50' },
  EXPIRED: { bg: 'bg-amber-950/30', text: 'text-amber-300', border: 'border-amber-700/50' }
};

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

// ============================================================================
// AgentCard Component
// ============================================================================

const AgentCard: FC<AgentCardProps> = ({
  agent,
  isSelected,
  isPinned,
  conversations,
  selectAgent,
  togglePinned,
  formatDateTime,
  extractRepoName,
  copiedRepoId,
  onCopyRepo
}) => {
  const agentColor = agent.configColor ?? DEFAULT_COLORS[0];
  const isRunning = agent.status === 'RUNNING';
  const createdAt = agent.createdAt ? formatDateTime(agent.createdAt) : 'N/A';

  // Extract repository from multiple sources
  const agentRepo = (agent['source'] && typeof agent['source'] === 'object' && 'repository' in agent['source'])
    ? (agent['source'] as { repository?: string })['repository']
    : agent['repository'] ?? agent['repo'];

  const agentConversation = conversations[agent.id];
  const conversationRepo = (agentConversation && 'source' in agentConversation && agentConversation['source'] && typeof agentConversation['source'] === 'object')
    ? (agentConversation['source'] as { repository?: string })['repository']
    : (agentConversation as { repository?: string | undefined })?.['repository'];

  const finalRepo = (agentRepo || conversationRepo) as string | undefined;
  const repoName = extractRepoName(finalRepo);

  // Get last message time
  const messages = agentConversation?.messages ?? [];
  const lastMessageWithTime = messages
    .filter((msg): msg is CursorConversationMessage & { createdAt: string } =>
      typeof msg === 'object' && msg !== null && typeof msg['createdAt'] === 'string'
    )
    .pop();

  const lastMessageTime = lastMessageWithTime
    ? formatDateTime(lastMessageWithTime['createdAt'])
    : typeof agent['updatedAt'] === 'string'
    ? formatDateTime(agent['updatedAt'])
    : null;

  const handleCopyRepo = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(repoName);
    onCopyRepo(agent.id);
    setTimeout(() => onCopyRepo(null), 2000);
  }, [agent.id, repoName, onCopyRepo]);

  const handleTogglePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    togglePinned(agent.id);
  }, [agent.id, togglePinned]);

  const statusStyle = STATUS_COLORS[agent.status ?? ''] ?? {
    bg: 'bg-card',
    text: 'text-muted-foreground',
    border: 'border-border'
  };

  return (
    <button
      type="button"
      onClick={() => void selectAgent(agent.id)}
      className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 ${
        isSelected
          ? 'border-primary bg-primary/10 shadow-sm'
          : 'border-border bg-card hover:bg-card-raised hover:border-primary/30'
      }`}
      style={isSelected ? { borderLeftColor: agentColor, borderLeftWidth: '3px' } : {}}
      aria-label={`Select agent ${agent.name ?? 'Unnamed'}`}
      aria-pressed={isSelected}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex items-start gap-2 flex-1">
          <div className="relative flex-shrink-0 mt-1.5">
            {isRunning && (
              <div className="absolute -top-0.5 -left-0.5 w-3 h-3 border-2 border-emerald-400 rounded-full animate-ping opacity-75" />
            )}
            <div
              className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400' : ''}`}
              style={{ backgroundColor: isRunning ? undefined : agentColor }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground truncate text-xs mb-0.5">
              {agent.name ?? 'Unnamed Agent'}
            </div>
            <button
              type="button"
              onClick={handleCopyRepo}
              className="text-[0.65rem] text-muted-foreground truncate hover:text-foreground transition-colors flex items-center gap-1 group focus:outline-none focus:ring-2 focus:ring-primary/50 rounded"
              title={copiedRepoId === agent.id ? "Copied!" : "Click to copy repository name"}
              aria-label={`Copy repository name: ${repoName}`}
            >
              <span className="truncate">{repoName}</span>
              {copiedRepoId === agent.id ? (
                <svg className="w-3 h-3 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3 opacity-0 group-hover:opacity-60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className={`text-[0.65rem] px-1.5 py-0.5 rounded border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                {agent.status ?? 'UNKNOWN'}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              <div className="text-[0.6rem] text-muted-foreground">Created: {createdAt}</div>
              {lastMessageTime ? (
                <div className="text-[0.6rem] text-muted-foreground">Last task: {lastMessageTime}</div>
              ) : agent['updatedAt'] ? (
                <div className="text-[0.6rem] text-muted-foreground">Updated: {formatDateTime(agent['updatedAt'] as string)}</div>
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleTogglePin}
          className="ml-1 p-1 hover:bg-primary/10 rounded transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
          title={isPinned ? "Unpin agent" : "Pin agent"}
          aria-label={isPinned ? "Unpin agent" : "Pin agent"}
        >
          <svg className={`w-3.5 h-3.5 ${isPinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v6m-3-3h6" />
          </svg>
        </button>
      </div>
    </button>
  );
};

// ============================================================================
// Message Component
// ============================================================================

interface MessageItemProps {
  message: CursorConversationMessage;
  isUnread: boolean;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onCopyFull: (id: string, text: string) => void;
}

const MessageItem: FC<MessageItemProps> = ({ message, isUnread, copiedId, onCopy, onCopyFull }) => {
  const isUser = message.type === 'user_message';
  const createdAt = typeof message['createdAt'] === 'string'
    ? new Date(message['createdAt']).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    : undefined;

  const isLastAssistant = !isUser && message.type === 'assistant_message';

  const handleCopy = useCallback(() => {
    if (message.id && message.text) {
      onCopy(message.id);
      setTimeout(() => onCopy(''), 2000);
    }
  }, [message.id, message.text, onCopy]);

  const handleCopyFull = useCallback(() => {
    if (message.id && message.text) {
      onCopyFull(message.id, message.text);
    }
  }, [message.id, message.text, onCopyFull]);

  return (
    <div
      id={message.id ? `message-${message.id}` : undefined}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'} ${isUnread ? 'bg-unread-highlight/30 rounded-lg -mx-2 px-2' : ''}`}
    >
      <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 backdrop-blur-sm ${
        isUser
          ? 'bg-primary/50 border-2 border-primary/70 shadow-lg'
          : 'bg-[#2A2535]/95 border-2 border-purple-500/30 shadow-lg'
      }`}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-xs font-semibold ${isUser ? 'text-[#E879F9]' : 'text-[#D8B4FE]'}`}>
            {isUser ? 'You' : 'Assistant'}
          </span>
          {createdAt && (
            <span className="text-[0.65rem] text-muted-foreground/70">
              {new Date(message['createdAt'] as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • {new Date(message['createdAt'] as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          )}
          {isUnread && (
            <span className="text-[0.6rem] px-1.5 py-0.5 bg-primary/20 text-primary rounded-full">
              New
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed mb-2 break-words">
          {message.text ?? ''}
        </div>
        {!isUser && message.text && (
          <div className="mt-2 pt-2 border-t border-border/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <span>Message ID: <code className="font-mono text-[0.65rem]">{message.id?.slice(0, 8) ?? 'N/A'}</code></span>
              {message.text.length > 0 && (
                <span>• {message.text.length} characters</span>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {message.text && message.id && (
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 hover:bg-card-raised/50 rounded transition-colors opacity-60 hover:opacity-100"
              title={copiedId === message.id ? "Copied!" : "Copy message"}
            >
              {copiedId === message.id ? (
                <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}
          {isLastAssistant && message.text && message.id && (
            <button
              type="button"
              onClick={handleCopyFull}
              className="p-1 hover:bg-card-raised/50 rounded transition-colors opacity-60 hover:opacity-100"
              title={copiedId === `full-${message.id}` ? "Copied!" : "Copy full reply"}
            >
              {copiedId === `full-${message.id}` ? (
                <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Loading Skeleton Component
// ============================================================================

const ConversationSkeleton: FC = () => (
  <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
    {[1, 2].map((i) => (
      <div key={i} className="flex gap-3 animate-pulse">
        <div className="w-8 h-8 rounded-full bg-purple-500/20" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-purple-500/20 rounded w-1/4" />
          <div className={`h-${i === 1 ? '16' : '24'} bg-purple-500/20 rounded`} />
        </div>
      </div>
    ))}
  </div>
);

// ============================================================================
// Main Dashboard Component
// ============================================================================

export const CloudAgentsDashboard: FC<CloudAgentsDashboardProps> = ({ initialConfigId }) => {
  // State
  const [localConfigs, setLocalConfigs] = useState<ApiConfig[]>([]);
  const [selectedConfigIds, setSelectedConfigIds] = useState<string[]>(initialConfigId ? [initialConfigId] : []);
  const [models, setModels] = useState<string[]>([]);
  const [repositories, setRepositories] = useState<string[]>([]);
  const [launchPrompt, setLaunchPrompt] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'EXPIRED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [copiedFullConversation, setCopiedFullConversation] = useState(false);
  const [copiedRepoId, setCopiedRepoId] = useState<string | null>(null);
  const [launchFeedback, setLaunchFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Refs for scroll management
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const conversationContainerRef = useRef<HTMLDivElement | null>(null);
  const previousMessageIdsRef = useRef<Set<string>>(new Set());
  const isUserScrolledUpRef = useRef<boolean>(false);
  const lastAutoScrollTimeRef = useRef<number>(0);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [firstUnreadId, setFirstUnreadId] = useState<string | undefined>(undefined);

  // Derived values
  const primaryConfigId = selectedConfigIds[0];
  const primaryConfig = localConfigs.find(c => c.id === primaryConfigId);
  const primaryApiKey = getApiKeyForConfig(primaryConfig ?? null);

  // Hooks
  const {
    state,
    selectAgent,
    refresh,
    refreshConversation,
    addMessageToConversation,
    markMessagesRead,
    markAllMessagesRead
  } = useCloudAgents({
    configId: primaryConfigId,
    apiKey: primaryApiKey,
    pollIntervalMs: undefined,
    conversationPollIntervalMs: 2000
  });

  const { state: actionsState, launch, stop, remove, followup } = useCloudAgentsActions({
    configId: primaryConfigId,
    apiKey: primaryApiKey
  });

  // =========================================================================
  // Effects
  // =========================================================================

  // Load configs from localStorage and environment variable
  useEffect(() => {
    const loadConfigs = async () => {
      setLocalConfigs(getAllApiConfigsSync());
      await loadEnvVarApiKey();
      const configs = await getAllApiConfigs();
      setLocalConfigs(configs);
    };
    loadConfigs();
  }, []);

  // Refresh configs when localStorage changes
  useEffect(() => {
    const handleStorageChange = (): void => {
      setLocalConfigs(getAllApiConfigsSync());
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleStorageChange);
    };
  }, []);

  // Initialize selected configs
  useEffect(() => {
    if (selectedConfigIds.length === 0 && localConfigs.length > 0) {
      const firstConfig = localConfigs[0];
      if (firstConfig) {
        setSelectedConfigIds([firstConfig.id]);
      }
    }
  }, [localConfigs, selectedConfigIds]);

  // Load models and repositories
  useEffect(() => {
    if (!primaryApiKey) return;
    const loadData = async () => {
      try {
        const [msResult, reposResult] = await Promise.all([
          fetchCloudAgentModels({ apiKey: primaryApiKey }),
          fetchCloudAgentRepositories({ apiKey: primaryApiKey })
        ]);
        setModels(msResult.models ?? []);
        setRepositories(reposResult.repositories?.map(r => r.repository) ?? []);
      } catch {
        // Fail silently
      }
    };
    loadData();
  }, [primaryApiKey]);

  // Update first unread ID when unread messages change
  useEffect(() => {
    const messages = state.conversation?.messages ?? [];
    for (const msg of messages) {
      if (msg.id && state.unreadMessageIds.has(msg.id) && !msg.id.startsWith('temp-')) {
        setFirstUnreadId(msg.id);
        break;
      }
    }
    if (state.unreadMessageIds.size === 0) {
      setFirstUnreadId(undefined);
    }
  }, [state.unreadMessageIds, state.conversation?.messages]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (!state.selectedAgentId) {
      previousMessageIdsRef.current = new Set();
      return;
    }

    const messages = state.conversation?.messages ?? [];
    const currentMessageIds = new Set<string>(
      messages.map(m => m.id).filter((id): id is string => Boolean(id))
    );

    const previousIds = previousMessageIdsRef.current;
    const hasNewMessages = [...currentMessageIds].some(id => !previousIds.has(id));

    const now = Date.now();
    const shouldAutoScroll = hasNewMessages &&
      !isUserScrolledUpRef.current &&
      (now - lastAutoScrollTimeRef.current > 300);

    if (shouldAutoScroll && conversationEndRef.current) {
      lastAutoScrollTimeRef.current = now;
      requestAnimationFrame(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }

    previousMessageIdsRef.current = currentMessageIds;
  }, [state.selectedAgentId, state.conversation?.messages]);

  // Scroll on agent selection change
  useEffect(() => {
    if (state.selectedAgentId && conversationEndRef.current) {
      isUserScrolledUpRef.current = false;
      setShowNewMessagesButton(false);
      previousMessageIdsRef.current = new Set();
      lastAutoScrollTimeRef.current = 0;

      requestAnimationFrame(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      });
    }
  }, [state.selectedAgentId]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        const searchInput = document.querySelector('input[placeholder*="Search by name"]') as HTMLInputElement;
        searchInput?.focus();
      }
      if (event.key === 'Escape' && state.selectedAgentId) {
        void selectAgent('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedAgentId, selectAgent]);

  // =========================================================================
  // Callbacks
  // =========================================================================

  const formatDateTime = useCallback((dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'N/A';
    }
  }, []);

  const extractRepoName = useCallback((repo?: string): string => {
    if (!repo) return 'N/A';
    try {
      const match = repo.match(/(?:github\.com\/|git@github\.com:)([^\/]+\/[^\/]+?)(?:\.git)?(?:\/|$)/);
      if (match && match[1]) return match[1];
      if (repo.includes('/') && !repo.startsWith('http')) return repo;
      return repo;
    } catch {
      return repo;
    }
  }, []);

  const checkScrollPosition = useCallback(() => {
    if (!conversationContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = conversationContainerRef.current;
    const scrollThreshold = 100;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= scrollThreshold;

    const wasScrolledUp = isUserScrolledUpRef.current;
    isUserScrolledUpRef.current = !isAtBottom;

    const shouldShowButton = !isAtBottom && state.pendingMessageCount > 0;
    setShowNewMessagesButton(shouldShowButton);

    if (wasScrolledUp && isAtBottom && state.pendingMessageCount > 0) {
      markMessagesRead(state.pendingMessageCount);
    }
  }, [state.pendingMessageCount, markMessagesRead]);

  const scrollToFirstUnread = useCallback(() => {
    if (firstUnreadId) {
      const el = document.getElementById(`message-${firstUnreadId}`);
      if (el) {
        isUserScrolledUpRef.current = false;
        setShowNewMessagesButton(false);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        markMessagesRead(1);
      }
    }
  }, [firstUnreadId, markMessagesRead]);

  const scrollToBottom = useCallback(() => {
    if (conversationEndRef.current) {
      isUserScrolledUpRef.current = false;
      setShowNewMessagesButton(false);
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      markAllMessagesRead();
    }
  }, [markAllMessagesRead]);

  const togglePinned = useCallback((agentId: string): void => {
    setPinnedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  }, []);

  const toggleConfigSelection = useCallback((configId: string): void => {
    setSelectedConfigIds((prev) => {
      if (prev.includes(configId)) {
        const filtered = prev.filter((id) => id !== configId);
        return filtered.length > 0 ? filtered : [configId];
      }
      return [...prev, configId];
    });
  }, []);

  const handleScroll = useCallback(() => {
    checkScrollPosition();
  }, [checkScrollPosition]);

  const handleCopyMessage = useCallback((id: string) => {
    setCopiedMessageId(id);
  }, []);

  const handleCopyFullReply = useCallback((id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedMessageId(`full-${id}`);
    setTimeout(() => setCopiedMessageId(''), 2000);
  }, []);

  const handleLaunch = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedRepo || !launchPrompt) {
      setLaunchFeedback({ type: 'error', message: 'Please select a repository and enter a task description' });
      setTimeout(() => setLaunchFeedback(null), 3000);
      return;
    }

    setLaunchFeedback({ type: 'success', message: 'Agent created successfully! Refreshing...' });

    try {
      await launch({
        promptText: launchPrompt,
        repository: selectedRepo,
        model: selectedModel,
        autoCreatePr: true
      });

      setLaunchPrompt('');
      setSelectedRepo('');
      setLaunchFeedback({ type: 'success', message: 'Agent launched successfully!' });
      setTimeout(() => setLaunchFeedback(null), 3000);
      void refresh();
    } catch (error) {
      setLaunchFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to launch agent'
      });
      setTimeout(() => setLaunchFeedback(null), 5000);
    }
  };

  const handleFollowup = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!state.selectedAgentId || !launchPrompt || actionsState.busy) return;

    const promptText = launchPrompt.trim();
    if (!promptText) return;

    setLaunchPrompt('');

    const tempMessageId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    addMessageToConversation(state.selectedAgentId, {
      type: 'user_message',
      text: promptText,
      id: tempMessageId
    });

    if (!isUserScrolledUpRef.current && conversationEndRef.current) {
      requestAnimationFrame(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }

    try {
      await followup(state.selectedAgentId, promptText);
    } catch (error) {
      console.error('Follow-up error:', error);
    }
  };

  // =========================================================================
  // Memos
  // =========================================================================

  const allConfigsForDisplay = useMemo(() =>
    localConfigs.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      color: c.color
    })),
    [localConfigs]
  );

  const agentsWithConfig: AgentWithConfig[] = useMemo(() =>
    state.agents.map((agent) => ({
      ...agent,
      configId: primaryConfigId,
      configColor: primaryConfigId ? getApiColor(primaryConfigId) : undefined,
      configName: allConfigsForDisplay.find((c) => c.id === primaryConfigId)?.name
    })),
    [state.agents, primaryConfigId, allConfigsForDisplay]
  );

  const filteredAgents = useMemo(() => {
    return agentsWithConfig.filter((agent) => {
      if (statusFilter !== 'ALL' && agent.status !== statusFilter) return false;
      if (!debouncedSearchQuery.trim()) return true;
      const q = debouncedSearchQuery.toLowerCase();
      const agentRepo = (agent['source'] && typeof agent['source'] === 'object' && 'repository' in agent['source'])
        ? (agent['source'] as { repository?: string })['repository']
        : agent['repository'] ?? agent['repo'] ?? '';

      return (
        (agent.name ?? '').toLowerCase().includes(q) ||
        agent.id.toLowerCase().includes(q) ||
        ((agentRepo ?? '') as string).toLowerCase().includes(q)
      );
    });
  }, [agentsWithConfig, statusFilter, debouncedSearchQuery]);

  const pinnedAgents = useMemo(() =>
    filteredAgents.filter((agent) => pinnedAgentIds.includes(agent.id)),
    [filteredAgents, pinnedAgentIds]
  );

  const otherAgents = useMemo(() =>
    filteredAgents.filter((agent) => !pinnedAgentIds.includes(agent.id)),
    [filteredAgents, pinnedAgentIds]
  );

  const currentAgent = useMemo(() =>
    agentsWithConfig.find((a) => a.id === state.selectedAgentId),
    [agentsWithConfig, state.selectedAgentId]
  );

  // Extract metadata from current agent
  const branchName = useMemo<string | undefined>(() => {
    if (!currentAgent) return undefined as string | undefined;
    const targetRepo = (currentAgent['target'] && typeof currentAgent['target'] === 'object' && 'branchName' in currentAgent['target'])
      ? (currentAgent['target'] as { branchName?: string })['branchName']
      : currentAgent['createdBranch'] ?? currentAgent['currentBranch'] ?? currentAgent['branchName'] ?? currentAgent['branch'];
    return targetRepo as string | undefined;
  }, [currentAgent]);

  const baseBranch = useMemo<string | undefined>(() => {
    if (!currentAgent) return undefined as string | undefined;
    const sourceRef = (currentAgent['source'] && typeof currentAgent['source'] === 'object' && 'ref' in currentAgent['source'])
      ? (currentAgent['source'] as { ref?: string })['ref']
      : currentAgent['baseBranch'] ?? currentAgent['baseRef'] ?? (currentAgent['ref'] && currentAgent['ref'] !== branchName ? currentAgent['ref'] : undefined) ?? 'main';
    return sourceRef as string | undefined;
  }, [currentAgent, branchName]);

  // =========================================================================
  // Export Functions
  // =========================================================================

  const exportConversation = useCallback((format: 'text' | 'json' | 'csv'): void => {
    if (!state.conversation?.messages || state.conversation.messages.length === 0) return;

    let content = '';
    const messages = state.conversation.messages;

    if (format === 'text') {
      content = messages.map((msg) => {
        const isUser = msg.type === 'user_message';
        const createdAt = msg['createdAt'] ? new Date(msg['createdAt'] as string).toLocaleString() : 'N/A';
        return `${isUser ? 'User' : 'Assistant'} [${createdAt}]:\n${msg.text ?? ''}\n`;
      }).join('\n---\n\n');
    } else if (format === 'json') {
      content = JSON.stringify(messages, null, 2);
    } else if (format === 'csv') {
      const headers = 'Type,Time,Text\n';
      const rows = messages.map((msg) => {
        const isUser = msg.type === 'user_message';
        const createdAt = msg['createdAt'] ? new Date(msg['createdAt'] as string).toISOString() : '';
        const text = (msg.text ?? '').replace(/"/g, '""');
        return `${isUser ? 'User' : 'Assistant'},"${createdAt}","${text}"`;
      }).join('\n');
      content = headers + rows;
    }

    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${currentAgent?.id ?? 'export'}-${new Date().toISOString()}.${format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.conversation?.messages, currentAgent?.id]);

  const copyFullConversation = useCallback((): void => {
    if (!state.conversation?.messages || state.conversation.messages.length === 0) return;
    const text = state.conversation.messages.map((msg) => {
      const isUser = msg.type === 'user_message';
      const createdAt = msg['createdAt'] ? new Date(msg['createdAt'] as string).toLocaleString() : '';
      return `${isUser ? 'User' : 'Assistant'} [${createdAt}]:\n${msg.text ?? ''}`;
    }).join('\n\n---\n\n');
    void navigator.clipboard.writeText(text);
    setCopiedFullConversation(true);
    setTimeout(() => setCopiedFullConversation(false), 2000);
  }, [state.conversation?.messages]);

  // =========================================================================
  // Render Helpers
  // =========================================================================

  const renderEmptyState = (title: string, description: string, icon?: ReactNode) => (
    <EmptyState
      icon={icon ?? (
        <svg className="w-16 h-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      )}
      title={title}
      description={description}
    />
  );

  const renderConversationHeader = () => {
    if (!state.selectedAgentId || !state.conversation?.messages || state.conversation.messages.length === 0) {
      return null;
    }

    return (
      <>
        <button
          type="button"
          onClick={copyFullConversation}
          className="p-1.5 hover:bg-card-raised rounded-lg transition-colors"
          title="Copy full conversation"
        >
          <svg className="w-4 h-4 text-muted-foreground hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="p-1.5 hover:bg-card-raised rounded-lg transition-colors"
            title="Export conversation"
          >
            <svg className="w-4 h-4 text-muted-foreground hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
          {showExportMenu && (
            <>
              <div className="absolute right-0 top-full mt-1 bg-card-raised border border-border rounded-lg shadow-lg z-50 min-w-[160px]">
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[0.7rem] text-muted-foreground border-b border-border">Download logs as...</div>
                  {(['text', 'json', 'csv'] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => { exportConversation(format); setShowExportMenu(false); }}
                      className="w-full text-left px-3 py-1.5 text-[0.7rem] text-foreground hover:bg-card capitalize"
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
            </>
          )}
        </div>
      </>
    );
  };

  const renderAgentDetails = () => {
    if (!currentAgent) return null;

    const requestId = currentAgent.id;
    const statusStyle = STATUS_COLORS[currentAgent.status ?? ''] ?? {
      bg: 'bg-card',
      text: 'text-muted-foreground',
      border: 'border-border'
    };

    return (
      <div className="flex-shrink-0 px-2 sm:px-3 md:px-4 py-2 sm:py-3 border border-border rounded-xl bg-card-raised">
        <div className="flex items-center justify-between gap-2 sm:gap-3 md:gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
            {currentAgent.configColor && (
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: currentAgent.configColor }} />
            )}
            <span className="text-sm font-semibold text-foreground">{currentAgent.name ?? 'Unnamed Agent'}</span>
            <button
              type="button"
              onClick={() => void selectAgent('')}
              className="p-1 hover:bg-card rounded transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
              title="Close agent and create new task (Esc)"
              aria-label="Close agent"
            >
              <svg className="w-4 h-4 text-muted-foreground hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {branchName && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">•</span>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(branchName!); }}
                  className="text-xs font-mono text-primary hover:text-primary-hover transition-colors cursor-pointer flex items-center gap-1"
                  title="Click to copy branch name"
                >
                  <span className="text-primary">{branchName}</span>
                  <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
            {baseBranch && baseBranch !== branchName && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground text-xs">from</span>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(baseBranch!); }}
                  className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                  title="Click to copy base branch name"
                >
                  <span>{baseBranch}</span>
                  <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {requestId && (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => { void navigator.clipboard.writeText(requestId); }}
                className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 min-w-0 flex-1"
                title="Click to copy full request ID"
              >
                <span className="truncate min-w-0">{requestId}</span>
                <svg className="w-3 h-3 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs px-2 py-1 rounded border font-medium ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
              {currentAgent.status ?? 'UNKNOWN'}
            </span>
            <button
              type="button"
              onClick={() => void stop(currentAgent.id)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-950/50 border border-amber-700/50 text-amber-300 hover:bg-amber-900/50 hover:border-amber-600 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              disabled={actionsState.busy}
              aria-label="Stop agent"
            >
              Stop
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(currentAgent.id)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-red-950/50 border border-red-700/50 text-red-300 hover:bg-red-900/50 hover:border-red-600 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
              disabled={actionsState.busy}
              aria-label="Delete agent"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  };

  // =========================================================================
  // Main Render
  // =========================================================================

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-full gap-2 sm:gap-3 p-2 sm:p-3 overflow-hidden flex-col lg:flex-row relative">
      {/* Sidebar Collapse Button */}
      {!sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="hidden lg:flex fixed left-[calc(20rem-1rem)] xl:left-[calc(24rem-1rem)] top-1/2 -translate-y-1/2 z-50 items-center justify-center w-8 h-16 bg-card border border-border rounded-r-lg hover:bg-card-raised transition-all duration-200 shadow-lg"
          aria-label="Collapse sidebar"
        >
          <svg className="w-4 h-4 text-muted-foreground transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-50 items-center justify-center w-8 h-16 bg-card border border-border rounded-r-lg hover:bg-card-raised transition-all duration-200 shadow-lg"
          aria-label="Expand sidebar"
        >
          <svg className="w-4 h-4 text-muted-foreground transition-transform duration-200 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Sidebar */}
      <aside className={`w-full lg:w-80 xl:w-96 flex-shrink-0 flex flex-col border border-border rounded-xl bg-card-raised overflow-hidden pattern-bg max-h-full lg:max-h-screen transition-all duration-200 ${
        sidebarCollapsed ? 'lg:w-0 lg:overflow-hidden lg:border-0 lg:p-0 lg:opacity-0' : ''
      }`}>
        <div className="flex-shrink-0 p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Cursor APIs</span>
          </div>

          {allConfigsForDisplay.length === 0 && (
            <p className="text-[0.7rem] text-muted-foreground">
              No configs found. Add APIs in Settings.
            </p>
          )}

          {allConfigsForDisplay.length > 0 && (
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {allConfigsForDisplay.map((config) => {
                const isSelected = selectedConfigIds.includes(config.id);
                return (
                  <label
                    key={config.id}
                    className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-card-raised transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleConfigSelection(config.id)}
                      className="w-4 h-4 rounded border-border bg-card text-primary focus:ring-2 focus:ring-ring"
                    />
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: config.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{config.name}</div>
                      {config.description && (
                        <div className="text-[0.65rem] text-muted-foreground truncate">{config.description}</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {!primaryApiKey && (
            <p className="text-[0.7rem] text-amber-400">No API key selected. Add APIs in Settings to view agents.</p>
          )}
          {primaryApiKey && state.userInfo && (
            <p className="text-[0.7rem] text-muted-foreground">
              Using key: <span className="font-mono">{state.userInfo.apiKeyName ?? 'N/A'}</span>
              {state.userInfo.userEmail ? ` • ${state.userInfo.userEmail}` : ''}
            </p>
          )}
          {primaryApiKey && state.userInfoError && (
            <p className="text-[0.7rem] text-red-400">API key error: {state.userInfoError}</p>
          )}
        </div>

        <div className="flex-shrink-0 p-2 sm:p-3 border-b border-border flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-textMuted">Agents: <span className="text-foreground font-medium">{filteredAgents.length}</span></span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="p-1.5 hover:bg-card-raised rounded-lg transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={state.loading}
              title="Refresh agents list (Ctrl+R)"
              aria-label="Refresh agents list"
            >
              <svg className="w-4 h-4 text-muted-foreground hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-nowrap overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {(['ALL', 'RUNNING', 'FINISHED', 'ERROR', 'EXPIRED'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-2 sm:px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                    statusFilter === status
                      ? 'border-primary bg-primary/20 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-card-raised hover:text-foreground'
                  }`}
                  aria-pressed={statusFilter === status}
                >
                  {status === 'ALL' ? 'All' : status.toLowerCase()}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="w-full rounded-lg bg-card border border-border px-2 sm:px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
              placeholder="Search by name, id, or repo (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search agents"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 sm:p-2 space-y-1.5" role="list" aria-label="Agents list">
          {state.loading && (
            <div className="space-y-2 py-4" role="status" aria-live="polite">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-16 bg-card rounded-lg border border-border" />
                </div>
              ))}
            </div>
          )}
          {!state.loading && filteredAgents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center" role="status">
              <svg className="w-12 h-12 text-muted-foreground mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-muted-foreground font-medium mb-1">No agents found</p>
              <p className="text-xs text-muted-foreground">
                {searchQuery.trim()
                  ? 'Try adjusting your search or filters'
                  : statusFilter !== 'ALL'
                    ? `No agents with status "${statusFilter.toLowerCase()}"`
                    : 'Create your first agent to get started'}
              </p>
            </div>
          )}

          {pinnedAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={agent.id === state.selectedAgentId}
              isPinned={true}
              conversations={state.conversationsByAgentId}
              selectAgent={selectAgent}
              togglePinned={togglePinned}
              formatDateTime={formatDateTime}
              extractRepoName={extractRepoName}
              copiedRepoId={copiedRepoId}
              onCopyRepo={setCopiedRepoId}
            />
          ))}

          {otherAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={agent.id === state.selectedAgentId}
              isPinned={false}
              conversations={state.conversationsByAgentId}
              selectAgent={selectAgent}
              togglePinned={togglePinned}
              formatDateTime={formatDateTime}
              extractRepoName={extractRepoName}
              copiedRepoId={copiedRepoId}
              onCopyRepo={setCopiedRepoId}
            />
          ))}
        </div>
      </aside>

      {/* Main content */}
      <section className={`flex-1 flex flex-col gap-2 min-h-0 overflow-hidden w-full lg:w-auto transition-all duration-200 ${
        sidebarCollapsed ? 'lg:ml-0' : ''
      }`}>
        {/* Agent Details */}
        {renderAgentDetails()}

        {/* Conversation Panel */}
        <div className="flex-1 flex flex-col border border-border rounded-xl bg-[#0A0711] overflow-hidden min-h-0 shadow-elevation-1 pattern-bg">
          <div className="flex-shrink-0 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border flex items-center justify-between bg-card">
            <h2 className="text-xs sm:text-sm font-semibold text-foreground">Conversation</h2>
            <div className="flex items-center gap-1.5">
              {renderConversationHeader()}
              <button
                type="button"
                onClick={() => (state.selectedAgentId ? void refreshConversation() : undefined)}
                className="p-1.5 hover:bg-card-raised rounded-lg transition-colors disabled:opacity-60"
                disabled={!state.selectedAgentId}
                title="Refresh conversation"
              >
                <svg className="w-4 h-4 text-muted-foreground hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* New Messages Button */}
          {showNewMessagesButton && state.pendingMessageCount > 0 && (
            <button
              type="button"
              onClick={scrollToFirstUnread}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-fadeInUp flex items-center gap-2 hover:bg-primary-hover transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              {state.pendingMessageCount} new message{state.pendingMessageCount > 1 ? 's' : ''}
            </button>
          )}

          {/* Loading State */}
          {state.selectedAgentId && state.isConversationLoading && <ConversationSkeleton />}

          {/* Empty States */}
          {!state.selectedAgentId && !state.isConversationLoading && renderEmptyState(
            'No agent selected',
            'Select an agent from the sidebar to view its conversation history and interact with it. Agents represent active AI-powered tasks working on your repositories.',
            undefined
          )}

          {state.selectedAgentId && !state.isConversationLoading && (!state.conversation?.messages || state.conversation.messages.length === 0) && renderEmptyState(
            'No messages yet',
            'This agent hasn\'t started working yet. Send a prompt below to begin the conversation and task execution.'
          )}

          {/* Messages */}
          {state.selectedAgentId && !state.isConversationLoading && state.conversation?.messages && state.conversation.messages.length > 0 && (
            <>
              <div
                ref={conversationContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 scroll-smooth"
              >
                {/* Thinking Indicator */}
                {currentAgent?.status === 'RUNNING' && (
                  <div className="flex items-center justify-start py-3 px-4">
                    <div className="flex items-center gap-3 bg-[#2A2535]/50 backdrop-blur-sm border border-purple-500/20 rounded-2xl px-4 py-3">
                      <div className="relative">
                        <div className="absolute -top-1 -left-1 w-3 h-3 bg-purple-400 rounded-full animate-ping opacity-75" />
                        <svg className="animate-spin h-5 w-5 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-purple-300">Thinking...</span>
                        <span className="text-xs text-muted-foreground/70">Processing your request</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Message List */}
                {state.conversation.messages.map((msg) => (
                  <MessageItem
                    key={msg.id ?? `${msg.type}-${Math.random()}`}
                    message={msg}
                    isUnread={msg.id ? state.unreadMessageIds.has(msg.id) && !msg.id.startsWith('temp-') : false}
                    copiedId={copiedMessageId}
                    onCopy={handleCopyMessage}
                    onCopyFull={handleCopyFullReply}
                  />
                ))}
                <div ref={conversationEndRef} />
              </div>
            </>
          )}
        </div>

        {/* Follow-up Panel */}
        <div className="flex-shrink-0 border-t border-border bg-card-raised p-2 sm:p-3 lg:p-4">
          <form onSubmit={currentAgent ? handleFollowup : handleLaunch} className="space-y-2 sm:space-y-3">
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-end">
              {!currentAgent && (
                <>
                  <div className="flex-1">
                    <label className="block text-xs text-muted-foreground mb-1.5">Repository</label>
                    {repositories.length > 5 && (
                      <input
                        type="text"
                        className="w-full mb-1.5 bg-card border border-border text-xs text-foreground rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                        placeholder="Search repositories..."
                        value={repoSearchQuery}
                        onChange={(e) => setRepoSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div className="relative">
                      <select
                        className="w-full bg-card border border-border text-sm text-foreground rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 appearance-none"
                        value={selectedRepo}
                        onChange={(e) => setSelectedRepo(e.target.value)}
                      >
                        <option value="">Select repository</option>
                        {repositories
                          .filter((repo) => !repoSearchQuery || repo.toLowerCase().includes(repoSearchQuery.toLowerCase()))
                          .map((repo) => (
                            <option key={repo} value={repo}>{repo}</option>
                          ))}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="w-40">
                    <label className="block text-xs text-muted-foreground mb-1.5">Model</label>
                    <select
                      className="w-full bg-card border border-border text-sm text-foreground rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                      value={selectedModel ?? ''}
                      onChange={(e) => setSelectedModel(e.target.value || undefined)}
                    >
                      <option value="">Auto</option>
                      {models.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="flex-1 w-full">
                <div className="flex flex-col sm:flex-row gap-2">
                  <textarea
                    className="flex-1 bg-card border border-border rounded-lg text-xs sm:text-sm text-foreground px-3 sm:px-4 py-2 sm:py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none min-h-[80px] sm:min-h-[100px] md:min-h-[120px]"
                    rows={3}
                    value={launchPrompt}
                    onChange={(e) => setLaunchPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && (currentAgent || (launchPrompt && selectedRepo))) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={currentAgent ? 'Add a follow-up instruction...' : 'Select an agent or create a new one to start...'}
                  />
                  <button
                    type="submit"
                    className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-smooth flex-shrink-0 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
                    disabled={actionsState.busy || (!currentAgent && (!launchPrompt.trim() || !selectedRepo))}
                    aria-label={currentAgent ? 'Send follow-up message' : 'Launch new agent'}
                  >
                    {actionsState.busy && (
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {actionsState.busy ? 'Sending...' : currentAgent ? 'Send' : 'Launch'}
                  </button>
                </div>
                {launchFeedback && (
                  <div className={`mt-2 px-3 py-2 rounded-lg text-xs ${
                    launchFeedback.type === 'success'
                      ? 'bg-green-950/30 border border-green-700/50 text-green-300'
                      : 'bg-red-950/30 border border-red-700/50 text-red-300'
                  }`}>
                    {launchFeedback.message}
                  </div>
                )}
                {actionsState.error && !launchFeedback && (
                  <p className="mt-2 text-xs text-red-400">{actionsState.error}</p>
                )}
              </div>
            </div>
          </form>
        </div>
      </section>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowDeleteConfirm(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card-raised border border-border rounded-xl p-6 max-w-md w-full shadow-xl">
              <h3 className="text-lg font-semibold text-foreground mb-2">Delete Agent?</h3>
              <p className="text-sm text-muted-foreground mb-6">
                This action cannot be undone. The agent and all its conversation history will be permanently deleted.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-card-raised transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (showDeleteConfirm) {
                      await remove(showDeleteConfirm);
                      setShowDeleteConfirm(null);
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-red-950/50 border border-red-700/50 text-red-300 hover:bg-red-900/50 hover:border-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  disabled={actionsState.busy}
                >
                  {actionsState.busy ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
