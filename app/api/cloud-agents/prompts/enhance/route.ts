/**
 * AI Prompt Enhancement API Route
 * 
 * Enhances user prompts using AI to make them more comprehensive and effective
 */
import { NextRequest, NextResponse } from 'next/server';
import type { AIPromptEnhancementRequest, AIPromptEnhancementResponse } from '@/features/cloud-agents/types/prompt-templates';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as AIPromptEnhancementRequest;
    const { originalPrompt, context, enhancementType = 'comprehensive' } = body;

    if (!originalPrompt || originalPrompt.trim().length < 10) {
      return NextResponse.json(
        { error: 'Prompt must be at least 10 characters long' },
        { status: 400 }
      );
    }

    // Get API key from request or environment
    const apiKey = request.headers.get('x-api-key') || process.env['CURSOR_API_KEY'];
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required for prompt enhancement' },
        { status: 401 }
      );
    }

    // Build enhancement prompt based on type
    const enhancementInstructions = {
      expand: 'Expand this prompt to include more details, context, and specific requirements. Make it comprehensive while keeping it clear and actionable.',
      refine: 'Refine and polish this prompt to be more professional, clear, and effective. Improve clarity, structure, and completeness.',
      optimize: 'Optimize this prompt for maximum effectiveness. Make it concise yet comprehensive, removing redundancy while ensuring all important details are included.',
      comprehensive: 'Transform this prompt into a comprehensive, professional, and well-structured prompt. Include all necessary context, requirements, acceptance criteria, and best practices. Make it production-ready.'
    };

    const instruction = enhancementInstructions[enhancementType] || enhancementInstructions.comprehensive;

    // Build context string
    let contextString = '';
    if (context) {
      if (context.repository) {
        contextString += `\nRepository: ${context.repository}`;
      }
      if (context.projectType) {
        contextString += `\nProject Type: ${context.projectType}`;
      }
      if (context.requirements && context.requirements.length > 0) {
        contextString += `\nAdditional Requirements:\n${context.requirements.map(r => `- ${r}`).join('\n')}`;
      }
    }

    // Create enhancement prompt for AI
    const enhancementPrompt = `You are an expert prompt engineer. Your task is to enhance the following user prompt to make it more comprehensive, professional, and effective.

${instruction}

Original Prompt:
"""
${originalPrompt}
"""
${contextString}

Please provide:
1. An enhanced version of the prompt that is more comprehensive, clear, and professional
2. A list of improvements made
3. Estimated token count for the enhanced prompt
4. Optional suggestions for further refinement

Return your response in JSON format with the following structure:
{
  "enhancedPrompt": "...",
  "improvements": ["...", "..."],
  "estimatedTokens": 123,
  "suggestions": ["...", "..."]
}`;

    // Call Cursor API to enhance the prompt
    const response = await fetch('https://api.cursor.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert prompt engineer specializing in creating comprehensive, professional prompts for software development tasks. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: enhancementPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { 
          error: 'Failed to enhance prompt',
          details: errorData.error?.message || 'Unknown error'
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || '';

    // Parse AI response (it should be JSON)
    let enhancedData: AIPromptEnhancementResponse;
    try {
      // Try to extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        enhancedData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: create response from text
        enhancedData = {
          enhancedPrompt: aiResponse.trim() || originalPrompt,
          improvements: ['Enhanced clarity and structure', 'Added comprehensive details', 'Improved professionalism'],
          estimatedTokens: Math.ceil(aiResponse.length / 4),
          suggestions: []
        };
      }
    } catch {
      // If parsing fails, use the raw response
      enhancedData = {
        enhancedPrompt: aiResponse.trim() || originalPrompt,
        improvements: ['Enhanced using AI', 'Improved structure and clarity'],
        estimatedTokens: Math.ceil(aiResponse.length / 4),
        suggestions: []
      };
    }

    // Ensure enhanced prompt is not empty
    if (!enhancedData.enhancedPrompt || enhancedData.enhancedPrompt.trim().length < originalPrompt.length) {
      enhancedData.enhancedPrompt = originalPrompt;
    }

    return NextResponse.json({
      success: true,
      data: enhancedData
    });

  } catch (error) {
    console.error('Prompt enhancement error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to enhance prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
