/**
 * Health Status Modal Component
 * 
 * Shows detailed health events for a service when clicked
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

interface HealthEvent {
  id: string;
  created_at: string;
  service: string;
  status: 'healthy' | 'warning' | 'error';
  message: string | null;
  payload: any;
}

interface HealthStatusModalProps {
  service: string;
  isOpen: boolean;
  onClose: () => void;
}

export function HealthStatusModal({ service, isOpen, onClose }: HealthStatusModalProps) {
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [latestHeartbeat, setLatestHeartbeat] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/cloud-agents/health/events?service=${service}&limit=20`);
      if (!response.ok) {
        throw new Error('Failed to load health events');
      }

      const data = await response.json();
      setEvents(data.data?.events || []);
      setLatestHeartbeat(data.data?.latestHeartbeat);
    } catch (error) {
      console.error('Failed to load health events', error);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (isOpen && service) {
      void loadEvents();
    }
  }, [isOpen, service, loadEvents]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-500 bg-green-500/10';
      case 'warning':
        return 'text-yellow-500 bg-yellow-500/10';
      case 'error':
        return 'text-red-500 bg-red-500/10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getServiceName = (service: string) => {
    const names: Record<string, string> = {
      'cursor_api': 'Cursor API',
      'supabase': 'Supabase',
      'redis': 'Redis',
      'worker': 'Orchestrator Worker'
    };
    return names[service] || service;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-card border rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{getServiceName(service)} Health Status</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : (
          <>
            {/* Latest Heartbeat (for worker) */}
            {latestHeartbeat && service === 'worker' && (
              <div className="mb-6 p-4 bg-muted/50 rounded-lg">
                <h3 className="font-semibold mb-2">Latest Heartbeat</h3>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Time: </span>
                    <span>{formatTimestamp(latestHeartbeat.created_at)}</span>
                  </div>
                  {latestHeartbeat.payload && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Worker ID: </span>
                        <code className="text-xs">{latestHeartbeat.payload.workerId}</code>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Uptime: </span>
                        <span>{Math.round(latestHeartbeat.payload.uptime / 60)} minutes</span>
                      </div>
                      {latestHeartbeat.payload.queue && (
                        <div className="mt-2">
                          <span className="text-muted-foreground">Queue: </span>
                          <span>
                            Waiting: {latestHeartbeat.payload.queue.waiting}, 
                            Active: {latestHeartbeat.payload.queue.active}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Health Events */}
            <div className="space-y-2">
              <h3 className="font-semibold mb-2">Recent Events</h3>
              {events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No events found</div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="p-3 border rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(event.status)}`}>
                        {event.status.toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(event.created_at)}
                      </span>
                    </div>
                    {event.message && (
                      <p className="text-sm text-muted-foreground mb-2">{event.message}</p>
                    )}
                    {event.payload && Object.keys(event.payload).length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-primary hover:underline">
                          View Details
                        </summary>
                        <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

