/**
 * AI Prompt Generator Component
 * 
 * Button with AI icon that enhances user prompts using AI
 */
'use client';

import { useState } from 'react';
import type { AIPromptEnhancementRequest } from '../types/prompt-templates';

interface AIPromptGeneratorProps {
  currentPrompt: string;
  onEnhanced: (enhancedPrompt: string) => void;
  context?: {
    repository?: string;
    projectType?: string;
    requirements?: string[];
  };
  apiKey?: string;
  className?: string;
}

export function AIPromptGenerator({
  currentPrompt,
  onEnhanced,
  context,
  apiKey,
  className = ''
}: AIPromptGeneratorProps) {
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);

  const handleEnhance = async () => {
    if (!currentPrompt || currentPrompt.trim().length < 10) {
      setError('Prompt must be at least 10 characters long');
      return;
    }

    setIsEnhancing(true);
    setError(null);
    setEnhancedPrompt(null);

    try {
      const requestBody: AIPromptEnhancementRequest = {
        originalPrompt: currentPrompt,
        context,
        enhancementType: 'comprehensive'
      };

      const response = await fetch('/api/cloud-agents/prompts/enhance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {})
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to enhance prompt');
      }

      const result = await response.json();
      const enhanced = result.data?.enhancedPrompt;

      if (!enhanced) {
        throw new Error('No enhanced prompt returned');
      }

      setEnhancedPrompt(enhanced);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enhance prompt');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleAccept = () => {
    if (enhancedPrompt) {
      onEnhanced(enhancedPrompt);
      setShowPreview(false);
      setEnhancedPrompt(null);
    }
  };

  const handleReject = () => {
    setShowPreview(false);
    setEnhancedPrompt(null);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleEnhance}
        disabled={isEnhancing || !currentPrompt || currentPrompt.trim().length < 10}
        className={`
          inline-flex items-center gap-2 px-3 py-2 rounded-lg
          bg-gradient-to-r from-purple-600 to-blue-600
          text-white font-medium text-sm
          hover:from-purple-700 hover:to-blue-700
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
          shadow-lg hover:shadow-xl
          ${isEnhancing ? 'animate-pulse' : ''}
        `}
        title="Enhance prompt using AI"
      >
        {isEnhancing ? (
          <>
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Enhancing...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>Enhance with AI</span>
          </>
        )}
      </button>

      {error && (
        <div className="absolute top-full left-0 mt-2 p-3 bg-red-950/90 border border-red-700/50 rounded-lg text-sm text-red-200 max-w-md z-50 shadow-xl">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium">Enhancement Failed</p>
              <p className="text-xs mt-1 opacity-90">{error}</p>
            </div>
          </div>
        </div>
      )}

      {showPreview && enhancedPrompt && (
        <div className="absolute top-full left-0 mt-2 w-[600px] max-w-[90vw] bg-card border border-border rounded-lg shadow-2xl z-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI Enhanced Prompt
            </h3>
            <button
              type="button"
              onClick={handleReject}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="mb-3 p-3 bg-background rounded border border-border max-h-64 overflow-y-auto">
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">
              {enhancedPrompt}
            </pre>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {enhancedPrompt.length} characters • ~{Math.ceil(enhancedPrompt.length / 4)} tokens
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReject}
                className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-card text-foreground hover:bg-card-raised transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAccept}
                className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Use Enhanced Prompt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
