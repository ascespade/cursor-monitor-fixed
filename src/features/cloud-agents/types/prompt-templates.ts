/**
 * Prompt Templates Types
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'feature' | 'refactor' | 'bugfix' | 'documentation' | 'testing' | 'custom';
  prompt: string;
  variables?: string[]; // e.g., ['projectName', 'featureName']
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
}

export interface PromptTemplateInput {
  name: string;
  description: string;
  category: PromptTemplate['category'];
  prompt: string;
  variables?: string[];
  tags?: string[];
}

export interface AIPromptEnhancementRequest {
  originalPrompt: string;
  context?: {
    repository?: string;
    projectType?: string;
    requirements?: string[];
  };
  enhancementType?: 'expand' | 'refine' | 'optimize' | 'comprehensive';
}

export interface AIPromptEnhancementResponse {
  enhancedPrompt: string;
  improvements: string[];
  estimatedTokens?: number;
  suggestions?: string[];
}
