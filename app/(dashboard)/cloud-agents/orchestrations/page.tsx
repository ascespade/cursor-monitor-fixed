/**
 * Orchestrations Dashboard
 * 
 * Lists all orchestration jobs with status, progress, and controls
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { HealthStatusModal } from '@/features/cloud-agents/components/HealthStatusModal';
import { EmptyState } from '@/shared/components/EmptyState';

interface Orchestration {
  id: string;
  masterAgentId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT';
  mode: string;
  repository: string;
  promptLength: number;
  tasksTotal: number;
  tasksCompleted: number;
  activeAgents: number;
  startedAt: string | null;
  updatedAt: string | null;
}

interface HealthStatus {
  cursorApi: { status: string; message: string };
  redisQueue: { status: string; message: string };
  orchestrator: { status: string; message: string };
}

export default function OrchestrationsPage() {
  const router = useRouter();
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);


  useEffect(() => {
    void loadOrchestrations();
    void loadHealthStatus();

    // Set up Supabase Realtime subscription for orchestrations table
    const supabase = createClientComponentClient();
    const channel = supabase
      .channel('orchestrations-list')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orchestrations'
        },
        () => {
          // Reload orchestrations when any change occurs
          void loadOrchestrations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orchestration_events'
        },
        () => {
          // Reload orchestrations when events change (to update progress/status)
          void loadOrchestrations();
        }
      )
      .subscribe();

    // Only refresh health status periodically (not orchestrations - they update via realtime)
    const healthInterval = setInterval(() => {
      void loadHealthStatus();
    }, 30000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(healthInterval);
    };
  }, []);

  const loadHealthStatus = async () => {
    try {
      const response = await fetch('/api/cloud-agents/health');
      if (response.ok) {
        const data = await response.json();
        setHealthStatus(data.data);
      }
    } catch {
      // Fail silently
    }
  };

  const loadOrchestrations = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Add cache-busting to ensure fresh data
      const response = await fetch(`/api/cloud-agents/orchestrations?limit=50&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to load orchestrations';
        let errorDetails: { status?: number; statusText?: string; requestId?: string } = {
          status: response.status,
          statusText: response.statusText
        };

        try {
          const errorData = await response.json();
          // Handle different error response formats
          if (typeof errorData === 'string') {
            errorMessage = errorData;
          } else if (errorData && typeof errorData === 'object') {
            if ('error' in errorData && typeof errorData.error === 'string') {
              errorMessage = errorData.error;
            } else if ('message' in errorData && typeof errorData.message === 'string') {
              errorMessage = errorData.message;
            } else if ('data' in errorData && typeof errorData.data === 'string') {
              errorMessage = errorData.data;
            }
            
            // Extract request ID if available
            if (errorData.meta?.requestId) {
              errorDetails.requestId = errorData.meta.requestId;
            }
          }
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }

        // Provide actionable error message
        if (response.status === 503) {
          errorMessage = 'Service temporarily unavailable. This may be expected in hybrid deployments. Please try again in a moment.';
        } else if (response.status === 500) {
          errorMessage = `Server error (${response.status}). Please check Supabase connectivity and try again.`;
        } else if (response.status === 404) {
          errorMessage = 'Orchestrations endpoint not found. Please check the API route configuration.';
        }

        setError(`${errorMessage}${errorDetails.requestId ? ` (Request ID: ${errorDetails.requestId})` : ''}${errorDetails.status ? ` [HTTP ${errorDetails.status}]` : ''}`);
        return;
      }
      
      const data = await response.json();
      const orchestrationsData = data?.data?.orchestrations || data?.orchestrations || [];
      
      if (!Array.isArray(orchestrationsData)) {
        setError('Invalid response format from server. Expected array of orchestrations.');
        setOrchestrations([]);
        return;
      }

      // Validate and sanitize orchestration data
      const validOrchestrations = orchestrationsData.map((orch: unknown) => {
        if (typeof orch !== 'object' || orch === null) {
          return null;
        }
        const o = orch as Record<string, unknown>;
        return {
          id: typeof o['id'] === 'string' ? o['id'] : '',
          masterAgentId: typeof o['masterAgentId'] === 'string' ? o['masterAgentId'] : '',
          status: (typeof o['status'] === 'string' && ['ACTIVE', 'COMPLETED', 'ERROR', 'TIMEOUT'].includes(o['status'])) 
            ? o['status'] as 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT'
            : 'ERROR' as const,
          mode: typeof o['mode'] === 'string' ? o['mode'] : 'AUTO',
          repository: typeof o['repository'] === 'string' ? o['repository'] : '',
          promptLength: typeof o['promptLength'] === 'number' ? o['promptLength'] : 0,
          tasksTotal: typeof o['tasksTotal'] === 'number' ? o['tasksTotal'] : 0,
          tasksCompleted: typeof o['tasksCompleted'] === 'number' ? o['tasksCompleted'] : 0,
          activeAgents: typeof o['activeAgents'] === 'number' ? o['activeAgents'] : 0,
          startedAt: typeof o['startedAt'] === 'string' ? o['startedAt'] : null,
          updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : null
        };
      }).filter((orch): orch is Orchestration => orch !== null);

      setOrchestrations(validOrchestrations);
      setError(null);
    } catch (err) {
      let message = 'Unknown error';
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'string') {
        message = err;
      } else if (err && typeof err === 'object') {
        // Safely extract message from error object
        if ('message' in err && typeof err.message === 'string') {
          message = err.message;
        } else if ('error' in err && typeof err.error === 'string') {
          message = err.error;
        } else {
          // Last resort: stringify if it's a simple object
          try {
            message = JSON.stringify(err);
          } catch {
            message = 'Failed to load orchestrations';
          }
        }
      }
      
      // Provide helpful error messages
      if (message.includes('fetch') || message.includes('network') || message.includes('Failed to fetch')) {
        setError('Network error: Unable to connect to the server. Please check your internet connection and try again.');
      } else if (message.includes('Supabase') || message.includes('database')) {
        setError(`Database error: ${message}. Please check Supabase configuration and connectivity.`);
      } else if (message === '[object Object]' || message.includes('[object Object]')) {
        setError('Failed to load orchestrations. Please refresh the page or contact support if the issue persists.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-500 bg-green-500/10';
      case 'ACTIVE':
        return 'text-blue-500 bg-blue-500/10';
      case 'ERROR':
        return 'text-red-500 bg-red-500/10';
      case 'TIMEOUT':
        return 'text-yellow-500 bg-yellow-500/10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const getModeBadge = (mode: string) => {
    const badges: Record<string, string> = {
      'SINGLE_AGENT': '🔵 Single',
      'PIPELINE': '➡️ Pipeline',
      'BATCH': '⚡ Batch',
      'AUTO': '🤖 Auto'
    };
    return badges[mode] || mode;
  };

  // Filter orchestrations based on search query
  const filteredOrchestrations = orchestrations.filter((orch) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (orch.id || '').toLowerCase().includes(q) ||
      (orch.masterAgentId || '').toLowerCase().includes(q) ||
      (orch.repository || '').toLowerCase().includes(q) ||
      (orch.mode || '').toLowerCase().includes(q) ||
      (orch.status || '').toLowerCase().includes(q)
    );
  });


  return (
    <main className="min-h-screen bg-background">
      <header className="flex-shrink-0 px-4 py-3 border-b border-border bg-card-raised/80 backdrop-blur-md shadow-elevation-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full animate-ping opacity-75"></div>
              <div className="relative w-3 h-3 bg-primary rounded-full"></div>
            </div>
            <div>
              <p className="text-xs font-mono text-muted-foreground mb-0.5">Cursor Cloud Monitor</p>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Orchestrations</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/cloud-agents"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Dashboard
            </Link>
            <Link
              href="/cloud-agents/orchestrate"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Start Orchestration
            </Link>
            <Link
              href="/cloud-agents/repository-profiles"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Profiles
            </Link>
            <Link
              href="/cloud-agents/settings"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </Link>
          </div>
        </div>
      </header>

      <div className="p-3 sm:p-4 md:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4 sm:mb-6">
          
          {/* Health Status Indicators */}
          {healthStatus && (
            <div className="flex items-center gap-3 flex-wrap p-3 bg-card-raised border border-border rounded-lg mb-4">
              <span className="text-xs text-muted-foreground font-medium">System Status:</span>
              <button
                onClick={() => setSelectedService('cursor_api')}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                title="Click to view Cursor API health events"
              >
                <div className={`w-2 h-2 rounded-full ${
                  healthStatus.cursorApi.status === 'ok' ? 'bg-emerald-400' :
                  healthStatus.cursorApi.status === 'warning' ? 'bg-amber-400' :
                  'bg-red-400'
                }`} />
                <span className="text-xs text-muted-foreground">API</span>
              </button>
              <button
                onClick={() => setSelectedService('redis')}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                title="Click to view Redis health events"
              >
                <div className={`w-2 h-2 rounded-full ${
                  healthStatus.redisQueue.status === 'ok' ? 'bg-emerald-400' :
                  healthStatus.redisQueue.status === 'warning' ? 'bg-amber-400' :
                  'bg-red-400'
                }`} />
                <span className="text-xs text-muted-foreground">Redis</span>
              </button>
              <button
                onClick={() => setSelectedService('worker')}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                title="Click to view Worker health events and heartbeat"
              >
                <div className={`w-2 h-2 rounded-full ${
                  healthStatus.orchestrator.status === 'ok' ? 'bg-emerald-400' :
                  healthStatus.orchestrator.status === 'warning' ? 'bg-amber-400' :
                  'bg-red-400'
                }`} />
                <span className="text-xs text-muted-foreground">Worker</span>
              </button>
              <button
                onClick={() => setSelectedService('supabase')}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                title="Click to view Supabase health events"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-muted-foreground">Supabase</span>
              </button>
              {(healthStatus.cursorApi.status !== 'ok' || healthStatus.redisQueue.status !== 'ok' || healthStatus.orchestrator.status !== 'ok') && (
                <span className="text-xs text-amber-400 ml-2">
                  ⚠️ Some services may be unavailable
                </span>
              )}
            </div>
          )}

          {/* Health Status Modal */}
          {selectedService && (
            <HealthStatusModal
              service={selectedService}
              isOpen={!!selectedService}
              onClose={() => setSelectedService(null)}
            />
          )}

          {/* Repository Search (like orchestrate page) */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Search Orchestrations by Repository
            </label>
            <div className="relative">
              <input
                type="text"
                className="w-full px-4 py-2 bg-background border rounded-lg"
                placeholder="Search repositories or enter URL manually..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchDropdown(e.target.value.trim().length > 0);
                }}
                onFocus={() => {
                  if (searchQuery.trim().length > 0) {
                    setShowSearchDropdown(true);
                  }
                }}
                onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
              />
              {showSearchDropdown && searchQuery.trim().length > 0 && filteredOrchestrations.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                  {filteredOrchestrations.slice(0, 10).map((orch) => (
                    <button
                      key={orch.id}
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-card-raised focus:bg-card-raised focus:outline-none"
                      onClick={() => {
                        setSearchQuery('');
                        setShowSearchDropdown(false);
                        const element = document.getElementById(`orch-${orch.id}`);
                        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      <div className="font-medium">{orch.repository || orch.id}</div>
                      <div className="text-xs text-muted-foreground">{orch.id.slice(0, 8)}... • {orch.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-sm text-muted-foreground">Loading orchestrations...</p>
            </div>
          </div>
        ) : filteredOrchestrations.length === 0 ? (
          orchestrations.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
              title="No orchestrations yet"
              description="Orchestrations are autonomous task execution workflows that break down large projects into manageable tasks and coordinate multiple AI agents to complete them efficiently."
              primaryAction={{
                label: 'Start Your First Orchestration',
                href: '/cloud-agents/orchestrate'
              }}
              secondaryAction={{
                label: 'Learn More',
                href: '#'
              }}
            />
          ) : (
            <EmptyState
              icon={
                <svg className="w-16 h-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              title="No orchestrations match your search"
              description={`We couldn't find any orchestrations matching "${searchQuery}". Try adjusting your search terms or clear the search to see all orchestrations.`}
              primaryAction={{
                label: 'Clear Search',
                onClick: () => setSearchQuery('')
              }}
            />
          )
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm">ID</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm hidden sm:table-cell">Mode</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm">Repository</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm">Status</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm">Progress</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm hidden md:table-cell">Active</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm hidden lg:table-cell">Started</th>
                    <th className="text-left p-2 sm:p-3 md:p-4 font-medium text-xs sm:text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrchestrations.map((orch) => (
                    <tr key={orch.id} id={`orch-${orch.id}`} className="border-b hover:bg-muted/30">
                      <td className="p-2 sm:p-3 md:p-4">
                        <code className="text-xs font-mono">{orch.id.slice(0, 8)}...</code>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4 hidden sm:table-cell">
                        <span className="text-xs sm:text-sm">{getModeBadge(orch.mode)}</span>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4">
                        {orch.repository ? (
                          <a
                            href={orch.repository}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs sm:text-sm text-primary hover:underline break-all"
                          >
                            {orch.repository.split('/').slice(-2).join('/')}
                          </a>
                        ) : (
                          <span className="text-xs sm:text-sm text-muted-foreground">N/A</span>
                        )}
                      </td>
                      <td className="p-2 sm:p-3 md:p-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(orch.status)}`}>
                          {orch.status}
                        </span>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden min-w-[40px] sm:min-w-[60px]">
                            <div
                              className="bg-primary h-full transition-all"
                              style={{
                                width: `${(orch.tasksTotal || 0) > 0 ? ((orch.tasksCompleted || 0) / (orch.tasksTotal || 1)) * 100 : 0}%`
                              }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
                            {orch.tasksCompleted || 0}/{orch.tasksTotal || 0}
                          </span>
                        </div>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4 hidden md:table-cell">
                        <span className="text-xs sm:text-sm">{orch.activeAgents || 0} agents</span>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {orch.startedAt 
                            ? new Date(orch.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : 'N/A'}
                        </span>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4">
                        <Link
                          href={`/cloud-agents/orchestrations/${orch.id}`}
                          className="text-xs sm:text-sm text-primary hover:underline whitespace-nowrap"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      </div>
    </main>
  );
}
