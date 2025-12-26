/**
 * Orchestration Timeline Component
 * 
 * n8n-like timeline visualization showing orchestration execution steps
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TimelineStep } from '@/features/cloud-agents/types/orchestration-events';
import { humanizeError } from '@/shared/utils/error-humanizer';

interface OrchestrationTimelineProps {
  timeline: TimelineStep[];
  orchestrationId: string;
  humanizedError?: {
    title: string;
    message: string;
    solution: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    actionUrl?: string;
    actionText?: string;
  } | null;
}

export function OrchestrationTimeline({ timeline, orchestrationId, humanizedError }: OrchestrationTimelineProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  
  // Find the latest error event across all steps
  const findLatestErrorEvent = (): { step: TimelineStep; log: any; index: number } | null => {
    let latestError: { step: TimelineStep; log: any; index: number } | null = null;
    let latestTimestamp = '';
    
    for (const step of timeline) {
      for (let i = step.logs.length - 1; i >= 0; i--) {
        const log = step.logs[i];
        if (log.level === 'error' && log.created_at > latestTimestamp) {
          latestTimestamp = log.created_at;
          latestError = { step, log, index: i };
        }
      }
    }
    
    return latestError;
  };
  
  const latestErrorEvent = findLatestErrorEvent();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return '✅';
      case 'running':
        return '⏳';
      case 'error':
        return '❌';
      default:
        return '⏸️';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-500 border-green-500 bg-green-500/10';
      case 'running':
        return 'text-blue-500 border-blue-500 bg-blue-500/10';
      case 'error':
        return 'text-red-500 border-red-500 bg-red-500/10';
      default:
        return 'text-muted-foreground border-muted-foreground bg-muted/30';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (startTime?: string, endTime?: string) => {
    if (!startTime || !endTime) return null;
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const duration = end - start;
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${Math.round(duration / 1000)}s`;
    return `${Math.round(duration / 60000)}m`;
  };

  const formatErrorMessage = (message: string, payload?: Record<string, unknown>): string => {
    // If message contains [object Object], try to extract better message from payload
    if (message.includes('[object Object]') && payload) {
      // Try to find error message in payload
      if (payload['error']) {
        if (typeof payload['error'] === 'string') {
          return `Job processing failed: ${payload['error']}`;
        }
        if (typeof payload['error'] === 'object' && payload['error'] !== null) {
          const errorObj = payload['error'] as Record<string, unknown>;
          if (errorObj['message'] && typeof errorObj['message'] === 'string') {
            return `Job processing failed: ${errorObj['message']}`;
          }
          if (errorObj['name'] && typeof errorObj['name'] === 'string') {
            return `Job processing failed: ${errorObj['name']}`;
          }
        }
      }
      // Fallback: show attempt info if available
      if (payload['attempts'] !== undefined) {
        const attempts = payload['attempts'];
        return `Job processing failed after ${attempts} attempt${Number(attempts) > 1 ? 's' : ''}. Check details for more information.`;
      }
      return 'Job processing failed. Check details for more information.';
    }
    return message;
  };

  const getHumanizedError = (message: string, level: string) => {
    if (level !== 'error') return null;
    return humanizeError(message, 'worker');
  };

  return (
    <div className="space-y-0">
      {timeline.length === 0 && (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-muted-foreground">No timeline events yet</p>
          <p className="text-xs text-muted-foreground mt-1">Timeline will appear as orchestration progresses</p>
        </div>
      )}
      {timeline.map((step, index) => {
        const isExpanded = expandedStep === step.stepKey;
        const hasLogs = step.logs.length > 0;
        const hasPayload = step.endEvent?.payload || step.startEvent?.payload;
        const duration = formatDuration(step.startEvent?.created_at, step.endEvent?.created_at);

        return (
          <div
            key={step.stepKey}
            className={`relative border-l-4 pl-4 sm:pl-6 pb-6 transition-all ${getStatusColor(step.status)} ${
              isExpanded ? 'bg-card/30' : ''
            }`}
          >
            <div className="flex items-start gap-3 sm:gap-4">
              {/* Step Icon - Clickable */}
              <button
                onClick={() => setExpandedStep(isExpanded ? null : step.stepKey)}
                className={`flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-lg border-2 flex items-center justify-center transition-all hover:scale-105 ${getStatusColor(step.status)} cursor-pointer shadow-sm`}
                title={isExpanded ? 'Click to collapse' : 'Click to expand'}
              >
                <span className="text-lg sm:text-xl">{getStatusIcon(step.status)}</span>
              </button>

              {/* Step Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-sm sm:text-base mb-1">{step.stepName}</h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
                      {step.startEvent && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {new Date(step.startEvent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(step.startEvent.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {duration && (
                        <span className="font-medium text-primary flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          {duration}
                        </span>
                      )}
                    </div>
                  </div>

                  {hasLogs && (
                    <button
                      onClick={() => setExpandedStep(isExpanded ? null : step.stepKey)}
                      className="text-xs text-primary hover:underline px-2 py-1 rounded hover:bg-primary/10"
                    >
                      {isExpanded ? '▼ Hide Details' : '▶ Show Details'}
                    </button>
                  )}
                </div>

                {/* Step Message - Humanized for errors */}
                {step.endEvent?.message && (() => {
                  // Check if this is the latest error event across all steps
                  const isLatestErrorStep = latestErrorEvent && 
                    latestErrorEvent.step.stepKey === step.stepKey;
                  
                  // Use humanizedError from API if this is the latest error step
                  const humanized = (isLatestErrorStep && humanizedError) 
                    ? humanizedError 
                    : getHumanizedError(step.endEvent.message, step.endEvent.level);
                  
                  if (humanized && step.status === 'error') {
                    return (
                      <div className="mt-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                              {humanized.title}
                            </h4>
                            <p className="text-sm text-red-800 dark:text-red-200 mb-2">
                              {humanized.message}
                            </p>
                            <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border border-red-200 dark:border-red-900/50">
                              <p className="text-xs font-medium text-red-900 dark:text-red-100 mb-1">
                                💡 How to fix:
                              </p>
                              <p className="text-xs text-red-800 dark:text-red-200">
                                {humanized.solution}
                              </p>
                            </div>
                            {humanized.actionUrl && humanized.actionText && (
                              <div className="mt-3">
                                <Link
                                  href={humanized.actionUrl}
                                  target={humanized.actionUrl.startsWith('http') ? '_blank' : '_self'}
                                  rel={humanized.actionUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  {humanized.actionText}
                                </Link>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  // Fallback to original message for non-errors or if humanization failed
                  return (
                    <p className="text-sm text-muted-foreground mt-2">
                      {formatErrorMessage(step.endEvent.message, step.endEvent.payload)}
                    </p>
                  );
                })()}

                {/* Progress Events Count */}
                {step.progressEvents.length > 0 && !isExpanded && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {step.progressEvents.length} progress update{step.progressEvents.length > 1 ? 's' : ''}
                  </p>
                )}

                {/* Expanded Details - n8n-style */}
                {isExpanded && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Status:</span>
                        <span className={`ml-2 font-medium ${
                          step.status === 'success' ? 'text-green-500' :
                          step.status === 'running' ? 'text-blue-500' :
                          step.status === 'error' ? 'text-red-500' :
                          'text-muted-foreground'
                        }`}>
                          {step.status.toUpperCase()}
                        </span>
                      </div>
                      {duration && (
                        <div>
                          <span className="text-muted-foreground">Duration:</span>
                          <span className="ml-2 font-medium">{duration}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Events:</span>
                        <span className="ml-2 font-medium">{step.logs.length}</span>
                      </div>
                    </div>

                    {/* Payload (if available) */}
                    {hasPayload && (
                      <div className="bg-muted/30 p-3 rounded-lg border">
                        <h4 className="text-sm font-semibold mb-2">Step Payload</h4>
                        <details>
                          <summary className="cursor-pointer text-xs text-primary hover:underline mb-2">
                            View Payload Data
                          </summary>
                          <pre className="mt-2 p-3 bg-background rounded text-xs overflow-x-auto max-h-64 overflow-y-auto">
                            {JSON.stringify(step.endEvent?.payload || step.startEvent?.payload, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}

                    {/* Event Logs */}
                    {hasLogs && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Event Logs</h4>
                        {step.logs.map((log, logIndex) => {
                          // Use humanizedError from API if this is the latest error event across all steps
                          const isLatestErrorEvent = latestErrorEvent && 
                            latestErrorEvent.step.stepKey === step.stepKey && 
                            latestErrorEvent.index === logIndex;
                          
                          // Use humanizedError from API for the latest error, otherwise humanize locally
                          const logHumanized = isLatestErrorEvent && humanizedError 
                            ? humanizedError 
                            : (log.level === 'error' ? getHumanizedError(log.message, log.level) : null);
                          
                          const isLatestError = isLatestErrorEvent || (logIndex === step.logs.length - 1 && log.level === 'error' && !latestErrorEvent);
                          
                          return (
                            <div
                              key={logIndex}
                              className={`p-3 rounded-lg border text-xs ${
                                isLatestError && logHumanized ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50' : 'bg-muted/50'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium px-2 py-0.5 rounded ${
                                    log.level === 'error' ? 'text-red-500 bg-red-500/10' :
                                    log.level === 'warn' ? 'text-yellow-500 bg-yellow-500/10' :
                                    'text-foreground bg-muted'
                                  }`}>
                                    {log.level.toUpperCase()}
                                  </span>
                                  {log.step_phase && (
                                    <span className="text-muted-foreground">
                                      ({log.step_phase})
                                    </span>
                                  )}
                                </div>
                                <span className="text-muted-foreground">
                                  {formatTimestamp(log.created_at)}
                                </span>
                              </div>
                              {isLatestError && logHumanized ? (
                                <div className="space-y-2">
                                  <p className="text-red-900 dark:text-red-100 font-medium mb-1">{logHumanized.title}</p>
                                  <p className="text-red-800 dark:text-red-200 mb-2">{logHumanized.message}</p>
                                  <div className="p-2 bg-white dark:bg-gray-900 rounded border border-red-200 dark:border-red-900/50">
                                    <p className="text-xs font-medium text-red-900 dark:text-red-100 mb-1">💡 How to fix:</p>
                                    <p className="text-xs text-red-800 dark:text-red-200">{logHumanized.solution}</p>
                                  </div>
                                  {logHumanized.actionUrl && logHumanized.actionText && (
                                    <Link
                                      href={logHumanized.actionUrl}
                                      target={logHumanized.actionUrl.startsWith('http') ? '_blank' : '_self'}
                                      rel={logHumanized.actionUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                      {logHumanized.actionText}
                                    </Link>
                                  )}
                                </div>
                              ) : (
                                <p className="text-foreground mb-2">{formatErrorMessage(log.message, log.payload)}</p>
                              )}
                              {log.payload && Object.keys(log.payload).length > 0 && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-primary hover:underline text-xs">
                                    View Payload ({Object.keys(log.payload).length} keys)
                                  </summary>
                                  <pre className="mt-2 p-2 bg-background rounded text-xs overflow-x-auto max-h-48 overflow-y-auto">
                                    {JSON.stringify(log.payload, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Connecting Line */}
            {index < timeline.length - 1 && (
              <div className={`ml-5 sm:ml-6 h-8 border-l-2 ${getStatusColor(step.status)} opacity-50`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

