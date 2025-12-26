/**
 * Prompt Templates Service
 * 
 * Manages prompt templates storage and retrieval
 */

import type { PromptTemplate, PromptTemplateInput } from '../types/prompt-templates';

export type { PromptTemplate, PromptTemplateInput };

const STORAGE_KEY = 'cursor_monitor_prompt_templates';

/**
 * Get all prompt templates from localStorage
 */
export function getAllPromptTemplates(): PromptTemplate[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return getDefaultTemplates();
    
    const templates = JSON.parse(stored) as PromptTemplate[];
    return templates.length > 0 ? templates : getDefaultTemplates();
  } catch {
    return getDefaultTemplates();
  }
}

/**
 * Get default prompt templates
 */
function getDefaultTemplates(): PromptTemplate[] {
  return [
    {
      id: 'default-feature',
      name: 'New Feature Implementation',
      description: 'Template for implementing a new feature',
      category: 'feature',
      prompt: 'Implement a new feature: {{featureName}}\n\nRequirements:\n- {{requirements}}\n\nAcceptance Criteria:\n- {{criteria}}',
      variables: ['featureName', 'requirements', 'criteria'],
      tags: ['feature', 'implementation'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    },
    {
      id: 'default-refactor',
      name: 'Code Refactoring',
      description: 'Template for refactoring existing code',
      category: 'refactor',
      prompt: 'Refactor the following code to improve:\n- Code quality\n- Performance\n- Maintainability\n\nFocus areas: {{focusAreas}}',
      variables: ['focusAreas'],
      tags: ['refactor', 'improvement'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    },
    {
      id: 'default-bugfix',
      name: 'Bug Fix',
      description: 'Template for fixing bugs',
      category: 'bugfix',
      prompt: 'Fix the following bug:\n\nIssue: {{issueDescription}}\n\nSteps to reproduce:\n1. {{step1}}\n2. {{step2}}\n\nExpected behavior: {{expectedBehavior}}\nActual behavior: {{actualBehavior}}',
      variables: ['issueDescription', 'step1', 'step2', 'expectedBehavior', 'actualBehavior'],
      tags: ['bugfix', 'fix'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    },
    {
      id: 'default-docs',
      name: 'Documentation Update',
      description: 'Template for updating documentation',
      category: 'documentation',
      prompt: 'Update documentation for: {{componentName}}\n\nDocumentation should include:\n- Overview\n- Usage examples\n- API reference\n- Best practices',
      variables: ['componentName'],
      tags: ['documentation', 'docs'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    }
  ];
}

/**
 * Save a prompt template
 */
export function savePromptTemplate(template: PromptTemplateInput): PromptTemplate {
  const templates = getAllPromptTemplates();
  const newTemplate: PromptTemplate = {
    ...template,
    id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0
  };
  
  templates.push(newTemplate);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  
  return newTemplate;
}

/**
 * Update a prompt template
 */
export function updatePromptTemplate(id: string, updates: Partial<PromptTemplateInput>): PromptTemplate | null {
  const templates = getAllPromptTemplates();
  const index = templates.findIndex(t => t.id === id);
  
  if (index === -1) return null;
  
  const existing = templates[index];
  if (!existing) return null;
  
  templates[index] = {
    ...existing,
    ...updates,
    id: existing.id, // Preserve ID
    createdAt: existing.createdAt, // Preserve creation date
    updatedAt: new Date().toISOString(),
    usageCount: existing.usageCount || 0
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  return templates[index] || null;
}

/**
 * Delete a prompt template
 */
export function deletePromptTemplate(id: string): boolean {
  const templates = getAllPromptTemplates();
  const filtered = templates.filter(t => t.id !== id);
  
  if (filtered.length === templates.length) return false;
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  return true;
}

/**
 * Get template by ID
 */
export function getPromptTemplateById(id: string): PromptTemplate | null {
  const templates = getAllPromptTemplates();
  return templates.find(t => t.id === id) || null;
}

/**
 * Get templates by category
 */
export function getPromptTemplatesByCategory(category: PromptTemplate['category']): PromptTemplate[] {
  const templates = getAllPromptTemplates();
  return templates.filter(t => t.category === category);
}

/**
 * Increment usage count for a template
 */
export function incrementTemplateUsage(id: string): void {
  const templates = getAllPromptTemplates();
  const template = templates.find(t => t.id === id);
  
  if (template) {
    template.usageCount = (template.usageCount || 0) + 1;
    template.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  }
}

/**
 * Replace variables in template prompt
 */
export function renderTemplatePrompt(template: PromptTemplate, variables: Record<string, string>): string {
  let prompt = template.prompt;
  
  if (template.variables) {
    for (const variable of template.variables) {
      const value = variables[variable] || `{{${variable}}}`;
      prompt = prompt.replace(new RegExp(`\\{\\{${variable}\\}\\}`, 'g'), value);
    }
  }
  
  return prompt;
}
