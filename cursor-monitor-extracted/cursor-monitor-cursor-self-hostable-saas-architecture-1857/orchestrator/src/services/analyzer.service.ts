/**
 * Analyzer Service
 * 
 * Analyzes agent progress using Cursor API
 * Makes intelligent decisions: CONTINUE, TEST, FIX, COMPLETE
 */

import { logger } from '../utils/logger';

const CURSOR_API_BASE = 'https://api.cursor.com/v0';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface AgentStatus {
  id: string;
  status: string;
  target?: {
    branchName?: string;
    prUrl?: string;
  };
  summary?: string;
}

interface AnalysisResult {
  action: 'CONTINUE' | 'TEST' | 'FIX' | 'COMPLETE';
  reasoning: string;
  followupMessage?: string;
  confidence: number;
  tasksCompleted: string[];
  tasksRemaining: string[];
  [key: string]: unknown;
}

class AnalyzerService {
  /**
   * Get API key dynamically from process.env
   * This allows the API key to be set after the service is instantiated
   */
  private getApiKey(): string {
    const apiKey = process.env['CURSOR_API_KEY'];
    if (!apiKey) {
      throw new Error('AUTH_FAILED: CURSOR_API_KEY is not set in process.env');
    }
    return apiKey;
  }

  /**
   * Main analysis function
   */
  async analyzeProgress(
    agentId: string,
    conversation: ConversationMessage[],
    agentStatus: AgentStatus,
    currentState: any
  ): Promise<AnalysisResult> {
    try {
      logger.info('Analyzing agent progress', { agentId });

      // Build analysis prompt
      const prompt = this.buildAnalysisPrompt(conversation, agentStatus, currentState);

      // Call Cursor API for analysis
      const analysis = await this.analyzeWithAPI(prompt);

      logger.info('Analysis completed', { agentId, action: analysis.action, confidence: analysis.confidence });

      return analysis;
    } catch (error) {
      logger.error('Analysis failed, using fallback', { agentId, error });
      return this.fallbackAnalysis(conversation, agentStatus, currentState);
    }
  }

  /**
   * Build detailed analysis prompt
   */
  private buildAnalysisPrompt(
    conversation: ConversationMessage[],
    agentStatus: AgentStatus,
    currentState: any
  ): string {
    const conversationText = conversation
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Agent'}: ${msg.content}`)
      .join('\n\n');

    const tasksCompleted = currentState?.tasks_completed || [];
    const tasksRemaining = currentState?.tasks_remaining || [];

    return `You are analyzing a Cursor Cloud Agent's progress. Review the conversation and determine the next action.

**Agent Status:**
- Branch: ${agentStatus.target?.branchName || 'N/A'}
- PR: ${agentStatus.target?.prUrl || 'N/A'}
- Summary: ${agentStatus.summary || 'N/A'}

**Tasks Completed:**
${tasksCompleted.length > 0 ? tasksCompleted.map((t: string) => `- ${t}`).join('\n') : '- None yet'}

**Tasks Remaining:**
${tasksRemaining.length > 0 ? tasksRemaining.map((t: string) => `- ${t}`).join('\n') : '- Unknown'}

**Conversation:**
${conversationText}

**Your Task:**
Analyze the conversation and determine:
1. What has been completed?
2. What remains to be done?
3. What should be the next action?

**Actions:**
- CONTINUE: Task is not complete, continue working
- TEST: Task appears complete, needs testing
- FIX: There are clear errors that need fixing
- COMPLETE: Everything is done and tested

**Response Format (JSON only):**
{
  "action": "CONTINUE|TEST|FIX|COMPLETE",
  "reasoning": "Detailed explanation of your decision",
  "followupMessage": "Message to send to agent (if CONTINUE or FIX)",
  "confidence": 0.0-1.0,
  "tasksCompleted": ["task1", "task2"],
  "tasksRemaining": ["task1", "task2"]
}`;
  }

  /**
   * Analyze using Cursor API
   */
  private async analyzeWithAPI(prompt: string): Promise<AnalysisResult> {
    try {
      // Use Cursor API chat endpoint
      const response = await fetch(`${CURSOR_API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.getApiKey()}:`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-4.5-opus-high-thinking',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`Cursor API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || data.content || '{}';

      return this.extractDecision(content);
    } catch (error) {
      logger.error('Cursor API analysis failed', { error });
      throw error;
    }
  }

  /**
   * Extract decision from API response
   */
  private extractDecision(content: string): AnalysisResult {
    try {
      // Try to parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonText);

      return {
        action: parsed.action || 'CONTINUE',
        reasoning: parsed.reasoning || 'No reasoning provided',
        followupMessage: parsed.followupMessage,
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        tasksCompleted: parsed.tasksCompleted || [],
        tasksRemaining: parsed.tasksRemaining || []
      };
    } catch (error) {
      logger.error('Failed to extract decision', { error, content });
      throw error;
    }
  }

  /**
   * Fallback analysis (simple rule-based)
   */
  private fallbackAnalysis(
    conversation: ConversationMessage[],
    agentStatus: AgentStatus,
    currentState: any
  ): AnalysisResult {
    const lastMessage = conversation[conversation.length - 1];
    const isError = lastMessage?.content.toLowerCase().includes('error') || 
                    lastMessage?.content.toLowerCase().includes('failed');

    if (isError) {
      return {
        action: 'FIX',
        reasoning: 'Detected error in conversation',
        followupMessage: 'Please fix the errors mentioned in the conversation',
        confidence: 0.6,
        tasksCompleted: currentState?.tasks_completed || [],
        tasksRemaining: currentState?.tasks_remaining || []
      };
    }

    const iterations = currentState?.iterations || 0;
    if (iterations >= 5) {
      return {
        action: 'TEST',
        reasoning: 'Multiple iterations completed, time to test',
        confidence: 0.7,
        tasksCompleted: currentState?.tasks_completed || [],
        tasksRemaining: currentState?.tasks_remaining || []
      };
    }

    return {
      action: 'CONTINUE',
      reasoning: 'Continuing based on default logic',
      followupMessage: 'Continue working on the task',
      confidence: 0.5,
      tasksCompleted: currentState?.tasks_completed || [],
      tasksRemaining: currentState?.tasks_remaining || []
    };
  }
}

export const analyzer = new AnalyzerService();

