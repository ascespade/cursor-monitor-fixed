/**
 * Error Humanizer Utility
 * 
 * Converts technical error messages into user-friendly, actionable messages
 * with clear instructions on how to resolve them.
 */

export interface HumanizedError {
  title: string;
  message: string;
  solution: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  actionUrl?: string;
  actionText?: string;
}

/**
 * Humanize error messages from various sources
 */
export function humanizeError(errorMessage: string, source?: 'database' | 'api' | 'worker' | 'cursor'): HumanizedError {
  const message = errorMessage.trim();
  const lowerMessage = message.toLowerCase();

  // Cursor API Errors
  if (lowerMessage.includes('hard limit') || lowerMessage.includes('remaining until')) {
    return {
      title: 'Insufficient Account Balance',
      message: 'Your Cursor API account needs more credit to run Background Agents.',
      solution: 'Increase your hard limit to at least $2 remaining. Go to your Cursor dashboard settings and adjust your spending limit.',
      severity: 'error',
      actionUrl: 'https://www.cursor.com/dashboard?tab=settings',
      actionText: 'Open Cursor Dashboard Settings'
    };
  }

  if (lowerMessage.includes('invalid cursor api key') || lowerMessage.includes('auth_failed') || lowerMessage.includes('401') || lowerMessage.includes('403')) {
    return {
      title: 'Invalid API Key',
      message: 'Your Cursor API key is invalid or expired.',
      solution: 'Please check your API key in the settings page. Make sure it\'s the correct key from your Cursor dashboard.',
      severity: 'error',
      actionUrl: '/cloud-agents/settings',
      actionText: 'Go to Settings'
    };
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return {
      title: 'Rate Limit Exceeded',
      message: 'You\'ve exceeded the rate limit for Cursor API requests.',
      solution: 'Please wait a few minutes before trying again. Consider upgrading your plan if this happens frequently.',
      severity: 'warning',
      actionUrl: 'https://www.cursor.com/dashboard?tab=settings',
      actionText: 'View Usage Limits'
    };
  }

  if (lowerMessage.includes('model') && (lowerMessage.includes('not available') || lowerMessage.includes('invalid'))) {
    return {
      title: 'Model Not Available',
      message: 'The selected AI model is not available or has been deprecated.',
      solution: 'The system will automatically use the best available model. You can also manually select a different model from the dropdown.',
      severity: 'warning',
      actionUrl: '/cloud-agents/orchestrate',
      actionText: 'Start New Orchestration'
    };
  }

  // Database Errors
  if (lowerMessage.includes('supabase') || lowerMessage.includes('database') || lowerMessage.includes('connection')) {
    return {
      title: 'Database Connection Issue',
      message: 'Unable to connect to the database.',
      solution: 'Please check your Supabase configuration and ensure the service is running. Verify your environment variables are set correctly.',
      severity: 'error',
      actionUrl: '/cloud-agents/settings',
      actionText: 'Check Settings'
    };
  }

  // Network Errors
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || lowerMessage.includes('econnrefused')) {
    return {
      title: 'Network Connection Problem',
      message: 'Unable to connect to the server.',
      solution: 'Please check your internet connection and try again. If the problem persists, the server may be temporarily unavailable.',
      severity: 'error',
      actionUrl: undefined,
      actionText: undefined
    };
  }

  // Validation Errors
  if (lowerMessage.includes('validation') || lowerMessage.includes('required') || lowerMessage.includes('invalid')) {
    return {
      title: 'Invalid Input',
      message: 'Some of the provided information is invalid or missing.',
      solution: 'Please review your input and make sure all required fields are filled correctly.',
      severity: 'warning',
      actionUrl: undefined,
      actionText: undefined
    };
  }

  // Worker/Processing Errors
  if (lowerMessage.includes('worker') || lowerMessage.includes('processing failed') || lowerMessage.includes('outbox')) {
    return {
      title: 'Processing Error',
      message: 'The orchestration failed to process. This may be due to a temporary issue.',
      solution: 'Try retrying the orchestration. If the problem persists, check the detailed error logs below for more information.',
      severity: 'error',
      actionUrl: undefined,
      actionText: undefined
    };
  }

  // Timeout Errors
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return {
      title: 'Operation Timed Out',
      message: 'The operation took too long to complete.',
      solution: 'This may happen with large projects. Try breaking down your task into smaller parts or increase the timeout limit.',
      severity: 'warning',
      actionUrl: undefined,
      actionText: undefined
    };
  }

  // Repository Errors
  if (lowerMessage.includes('repository') || lowerMessage.includes('github') || lowerMessage.includes('git')) {
    return {
      title: 'Repository Access Issue',
      message: 'Unable to access the specified repository.',
      solution: 'Please verify that the repository URL is correct and that you have access to it. Make sure the repository is public or your API key has the necessary permissions.',
      severity: 'error',
      actionUrl: undefined,
      actionText: undefined
    };
  }

  // Generic Cursor API Errors
  if (lowerMessage.includes('cursor_api_error') || lowerMessage.includes('cursor api')) {
    // Extract the actual error message
    const match = message.match(/CURSOR_API_ERROR:\s*\d+\s*-\s*(.+?)(?:\s*\(at|$)/i);
    const actualError = match && match[1] ? match[1].trim() : message;

    return {
      title: 'Cursor API Error',
      message: actualError,
      solution: 'This is an error from the Cursor API. Please check the error details above and refer to Cursor documentation for more information.',
      severity: 'error',
      actionUrl: 'https://cursor.com/docs/cloud-agent/api/endpoints',
      actionText: 'View Cursor API Docs'
    };
  }

  // Default fallback
  return {
    title: 'An Error Occurred',
    message: message.length > 200 ? message.substring(0, 200) + '...' : message,
    solution: 'Please check the error details and try again. If the problem persists, contact support with the error message.',
    severity: 'error',
    actionUrl: undefined,
    actionText: undefined
  };
}

/**
 * Extract error message from various error formats
 */
export function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const errorObj = error as Record<string, unknown>;
    
    // Try common error message fields
    if (typeof errorObj['message'] === 'string') {
      return errorObj['message'];
    }
    
    if (typeof errorObj['error'] === 'string') {
      return errorObj['error'];
    }
    
    if (errorObj['error'] && typeof errorObj['error'] === 'object') {
      const nestedError = errorObj['error'] as Record<string, unknown>;
      if (typeof nestedError['message'] === 'string') {
        return nestedError['message'];
      }
    }

    // Try to stringify if it's a simple object
    try {
      const str = JSON.stringify(error);
      if (str.length < 500) {
        return str;
      }
    } catch {
      // Ignore stringify errors
    }
  }

  return 'An unknown error occurred';
}

/**
 * Get the latest error message from orchestration events
 * This ensures we always show the most recent error, not cached/stale data
 */
export async function getLatestErrorFromDatabase(
  orchestrationId: string,
  supabaseClient: any
): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient
      .from('orchestration_events')
      .select('message')
      .eq('orchestration_id', orchestrationId)
      .eq('level', 'error')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.message || null;
  } catch {
    return null;
  }
}


