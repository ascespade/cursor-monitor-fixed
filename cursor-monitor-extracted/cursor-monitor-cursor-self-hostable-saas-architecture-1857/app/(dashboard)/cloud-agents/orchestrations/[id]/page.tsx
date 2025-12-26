/**
 * Orchestration Details Page
 * 
 * Shows detailed view of a single orchestration job
 * - Task list with status
 * - Timeline
 * - Controls (Pause/Resume/Cancel)
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { TaskDetail } from '@/features/cloud-agents/types/tasks';
import { OrchestrationTimeline } from '@/features/cloud-agents/components/OrchestrationTimeline';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { humanizeError } from '@/shared/utils/error-humanizer';

interface OrchestrationStatus {
  masterAgentId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT';
  mode: string;
  currentTask?: string;
  tasksCompleted: number;
  tasksTotal: number;
  activeAgents: number;
  iterations: number;
  startedAt: string;
  updatedAt: string;
}

export default function OrchestrationDetailsPage() {
  const params = useParams();
  const id = params['id'] as string;
  
  const [status, setStatus] = useState<OrchestrationStatus | null>(null);
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [orchestration, setOrchestration] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
    void loadTimeline();

    // Set up Supabase realtime subscription for events
    const supabase = createClientComponentClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    try {
      channel = supabase
        .channel(`orchestration-${id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orchestration_events',
            filter: `orchestration_id=eq.${id}`
          },
          () => {
            // Reload timeline when events change
            void loadTimeline();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orchestrations',
            filter: `id=eq.${id}`
          },
          () => {
            // Reload data when orchestration status changes
            void loadData();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Successfully subscribed - clear any polling
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Realtime connection failed - fallback to polling
            console.warn('Supabase Realtime connection failed, using polling fallback');
            if (!pollInterval) {
              pollInterval = setInterval(() => {
                void loadData();
                void loadTimeline();
              }, 5000); // Poll every 5 seconds
            }
          }
        });
    } catch (error) {
      // Realtime subscription failed - use polling as fallback
      console.warn('Failed to setup Realtime subscription, using polling fallback', error);
      pollInterval = setInterval(() => {
        void loadData();
        void loadTimeline();
      }, 5000);
    }

    // Cleanup function
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status?.status]);

  const loadData = async () => {
    try {
      const [statusRes, tasksRes] = await Promise.all([
        fetch(`/api/cloud-agents/orchestrate/${id}/status`),
        fetch(`/api/cloud-agents/orchestrate/${id}/tasks`)
      ]);

      if (!statusRes.ok || !tasksRes.ok) {
        throw new Error('Failed to load orchestration details');
      }

      const statusData = await statusRes.json();
      const tasksData = await tasksRes.json();

      setStatus(statusData.data);
      setTasks(tasksData.data.tasks || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const loadTimeline = async () => {
    try {
      const response = await fetch(`/api/cloud-agents/orchestrations/${id}/events`);
      if (!response.ok) {
        // Non-fatal - timeline is optional
        return;
      }

      const data = await response.json();
      setTimeline(data.data?.timeline || []);
      setOrchestration(data.data?.orchestration || null);
    } catch (err) {
      // Non-fatal - timeline is optional
      console.warn('Failed to load timeline', err);
    }
  };

  const handlePause = async () => {
    try {
      const response = await fetch(`/api/cloud-agents/orchestrate/${id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' })
      });

      if (!response.ok) throw new Error('Failed to pause');
      
      await loadData();
      alert('Orchestration paused');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to pause');
    }
  };

  const handleRetry = async () => {
    if (!confirm('Are you sure you want to retry this orchestration? This will create a new job and consume one of your daily limits.')) {
      return;
    }

    try {
      setLoading(true);
      
      // Get API key from localStorage or prompt user
      let apiKey = localStorage.getItem('cursor_api_key') || '';
      
      if (!apiKey) {
        const userInput = prompt('Please enter your Cursor API key to retry this orchestration:');
        if (!userInput) {
          alert('API key is required to retry orchestration');
          return;
        }
        apiKey = userInput;
        localStorage.setItem('cursor_api_key', apiKey);
      }

      // Pass API key as query parameter (getApiKeyFromRequest reads from query params)
      const url = new URL(`/api/cloud-agents/orchestrations/${id}/retry`, window.location.origin);
      url.searchParams.set('apiKey', apiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Failed to retry orchestration');
      }
      
      await loadData();
      alert('Orchestration queued for retry! It will start processing shortly.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to retry orchestration');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this orchestration?')) return;
    
    try {
      const response = await fetch(`/api/cloud-agents/orchestrate/${id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });

      if (!response.ok) throw new Error('Failed to cancel');
      
      await loadData();
      alert('Orchestration cancelled');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  if (loading) {
    return (
      <div className="h-full w-full p-6 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm text-muted-foreground">Loading orchestration details...</p>
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="h-full w-full p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-destructive/10 border border-destructive rounded-lg p-6 text-center">
            <p className="text-destructive font-medium">{error || 'Orchestration not found'}</p>
            <Link
              href="/cloud-agents/orchestrations"
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              ← Back to Orchestrations
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Orchestration Details</h1>
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
              href="/cloud-agents/orchestrations"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Orchestrations
            </Link>
          </div>
        </div>
      </header>

      <div className="p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Humanized Error Banner - Show if orchestration has error */}
          {orchestration?.humanizedError && (status.status === 'ERROR' || orchestration.error_summary) && (
            <div className={`p-4 rounded-lg border ${
              orchestration.humanizedError.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50' :
              orchestration.humanizedError.severity === 'error' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50' :
              orchestration.humanizedError.severity === 'warning' ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900/50' :
              'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50'
            }`}>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? (
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : orchestration.humanizedError.severity === 'warning' ? (
                    <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm font-semibold mb-1 ${
                    orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? 'text-red-900 dark:text-red-100' :
                    orchestration.humanizedError.severity === 'warning' ? 'text-yellow-900 dark:text-yellow-100' :
                    'text-blue-900 dark:text-blue-100'
                  }`}>
                    {orchestration.humanizedError.title}
                  </h3>
                  <p className={`text-sm mb-3 ${
                    orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? 'text-red-800 dark:text-red-200' :
                    orchestration.humanizedError.severity === 'warning' ? 'text-yellow-800 dark:text-yellow-200' :
                    'text-blue-800 dark:text-blue-200'
                  }`}>
                    {orchestration.humanizedError.message}
                  </p>
                  <div className={`mt-3 p-3 rounded border ${
                    orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? 'bg-white dark:bg-gray-900 border-red-200 dark:border-red-900/50' :
                    orchestration.humanizedError.severity === 'warning' ? 'bg-white dark:bg-gray-900 border-yellow-200 dark:border-yellow-900/50' :
                    'bg-white dark:bg-gray-900 border-blue-200 dark:border-blue-900/50'
                  }`}>
                    <p className={`text-xs font-medium mb-1 ${
                      orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? 'text-red-900 dark:text-red-100' :
                      orchestration.humanizedError.severity === 'warning' ? 'text-yellow-900 dark:text-yellow-100' :
                      'text-blue-900 dark:text-blue-100'
                    }`}>
                      💡 How to fix:
                    </p>
                    <p className={`text-xs ${
                      orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? 'text-red-800 dark:text-red-200' :
                      orchestration.humanizedError.severity === 'warning' ? 'text-yellow-800 dark:text-yellow-200' :
                      'text-blue-800 dark:text-blue-200'
                    }`}>
                      {orchestration.humanizedError.solution}
                    </p>
                  </div>
                  {orchestration.humanizedError.actionUrl && orchestration.humanizedError.actionText && (
                    <div className="mt-3">
                      <Link
                        href={orchestration.humanizedError.actionUrl}
                        target={orchestration.humanizedError.actionUrl.startsWith('http') ? '_blank' : '_self'}
                        rel={orchestration.humanizedError.actionUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors ${
                          orchestration.humanizedError.severity === 'critical' || orchestration.humanizedError.severity === 'error' ? 'bg-red-600 hover:bg-red-700' :
                          orchestration.humanizedError.severity === 'warning' ? 'bg-yellow-600 hover:bg-yellow-700' :
                          'bg-blue-600 hover:bg-blue-700'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        {orchestration.humanizedError.actionText}
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Header Info */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
              <code className="text-xs font-mono text-muted-foreground bg-card px-2 py-1 rounded">{id}</code>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                status.status === 'COMPLETED' ? 'bg-green-500/10 text-green-500 border border-green-500/30' :
                status.status === 'ACTIVE' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/30' :
                status.status === 'ERROR' ? 'bg-red-500/10 text-red-500 border border-red-500/30' :
                'bg-muted text-muted-foreground border border-border'
              }`}>
                {status.status}
              </span>
              </div>
            </div>
          <div className="flex gap-2">
            {status.status === 'ACTIVE' && (
              <>
                <button
                  onClick={handlePause}
                  className="px-4 py-2 border border-border bg-card text-foreground rounded-lg hover:bg-card-raised transition-colors"
                >
                  ⏸️ Pause
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 border border-red-700/50 bg-red-950/30 text-red-300 rounded-lg hover:bg-red-900/50 transition-colors"
                >
                  ❌ Cancel
                </button>
              </>
            )}
            {status.status === 'ERROR' && (
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                🔄 Retry
              </button>
            )}
          </div>
        </div>

        {/* System Observability Panel */}
        <section className="bg-card p-4 sm:p-6 rounded-lg border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">System Health</h2>
            <a
              href="/api/cloud-agents/health"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View Full Report →
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3 bg-card-raised rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Worker Status</div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-foreground">Online</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">Heartbeats every 30s</div>
            </div>
            <div className="p-3 bg-card-raised rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Execution Mode</div>
              <div className="text-sm font-medium text-foreground">{status.mode}</div>
              <div className="text-xs text-muted-foreground mt-1">{status.activeAgents} active agents</div>
            </div>
            <div className="p-3 bg-card-raised rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Progress</div>
              <div className="text-sm font-medium text-foreground">
                {status.tasksCompleted}/{status.tasksTotal} tasks
              </div>
              <div className="mt-2 bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all"
                  style={{
                    width: `${status.tasksTotal > 0 ? (status.tasksCompleted / status.tasksTotal) * 100 : 0}%`
                  }}
                />
              </div>
            </div>
            <div className="p-3 bg-card-raised rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Started</div>
              <div className="text-sm font-medium text-foreground">
                {new Date(status.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {new Date(status.startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        </section>

        {/* Timeline - n8n-style */}
        <section className="bg-card p-4 sm:p-6 rounded-lg border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Execution Timeline</h2>
            <span className="text-xs text-muted-foreground">
              {timeline.length} step{timeline.length !== 1 ? 's' : ''}
            </span>
          </div>
          {timeline.length > 0 ? (
            <OrchestrationTimeline 
            timeline={timeline} 
            orchestrationId={id}
            humanizedError={orchestration?.humanizedError || null}
          />
          ) : (
            <div className="text-center py-12">
              <svg className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-muted-foreground">No timeline events yet</p>
              <p className="text-xs text-muted-foreground mt-1">Timeline will appear as orchestration progresses</p>
            </div>
          )}
        </section>


        {/* Quality Score (if available) */}
        {status.status === 'COMPLETED' && (
          <section className="bg-card p-6 rounded-lg border mb-6">
            <h2 className="text-xl font-semibold mb-4">Quality Score</h2>
            <div className="text-center">
              <div className="text-4xl font-bold text-primary mb-2">
                {/* TODO: Fetch from status */}
                N/A
              </div>
              <p className="text-sm text-muted-foreground">
                Quality metrics and recommendations
              </p>
            </div>
          </section>
        )}

        {/* Tasks List */}
        <section className="bg-card p-4 sm:p-6 rounded-lg border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Tasks</h2>
            <Link
              href={`/cloud-agents/orchestrations/${id}/pipeline`}
              className="text-sm text-primary hover:underline"
            >
              View Pipeline →
            </Link>
          </div>
          {tasks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No tasks yet. Tasks will appear as orchestration progresses.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 border border-border rounded-lg hover:bg-card-raised transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${
                          task.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/30' :
                          task.status === 'running' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30' :
                          task.status === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                          'bg-muted text-muted-foreground border-border'
                        }`}>
                          {task.status.toUpperCase()}
                        </span>
                        <span className="text-sm font-semibold text-foreground">{task.title}</span>
                        {task.priority === 'high' && (
                          <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 text-orange-500 border border-orange-500/30">High Priority</span>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-sm text-muted-foreground mb-3">{task.description}</p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {task.agentId && (
                          <div className="flex items-center gap-1">
                            <span>Agent:</span>
                            <code className="bg-card-raised px-1.5 py-0.5 rounded font-mono">{task.agentId.slice(0, 8)}...</code>
                          </div>
                        )}
                        {task.branchName && (
                          <div className="flex items-center gap-1">
                            <span>Branch:</span>
                            <code className="bg-card-raised px-1.5 py-0.5 rounded font-mono">{task.branchName}</code>
                          </div>
                        )}
                        {task.prUrl && (
                          <a 
                            href={task.prUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            View PR
                          </a>
                        )}
                        {task.dependencies.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span>Depends on:</span>
                            <span className="font-medium">{task.dependencies.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </main>
  );
}
