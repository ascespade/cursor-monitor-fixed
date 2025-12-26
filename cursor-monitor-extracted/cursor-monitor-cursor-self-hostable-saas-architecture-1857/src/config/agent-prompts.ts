/**
 * Agent Prompts Configuration (Aggregator)
 *
 * Purpose:
 * - Provide a single import point for all AI prompts used by this starter:
 *   the master system prompt, mode-specific prompts, and the original v1 prompt.
 *
 * Usage:
 * - Import MASTER_PROMPT for the main System Prompt.
 * - Import MODE_PROMPTS[mode] when you want a focused role prompt.
 * - Import ORIGINAL_MASTER_PROMPT_V1 if you need the raw first-generation text.
 */
import { MASTER_PROMPT } from './prompts/master.prompt';
import { ORIGINAL_MASTER_PROMPT_V1 } from './prompts/original-master-v1.prompt';
import { ARCHITECTURE_REFACTORING_PROMPT } from './prompts/mode.architecture-refactoring.prompt';
import { BACKEND_SECURITY_PROMPT } from './prompts/mode.backend-security.prompt';
import { FRONTEND_UX_PROMPT } from './prompts/mode.frontend-ux.prompt';
import { DATA_OBSERVABILITY_PROMPT } from './prompts/mode.data-observability.prompt';
import { TESTING_QA_PROMPT } from './prompts/mode.testing-qa.prompt';
import { DEVOPS_PERFORMANCE_PROMPT } from './prompts/mode.devops-performance.prompt';
import { DOCS_DX_PROMPT } from './prompts/mode.docs-dx.prompt';
import { PRODUCT_WORKFLOWS_PROMPT } from './prompts/mode.product-workflows.prompt';
import { DB_ARCHITECT_PROMPT } from './prompts/mode.db-architect.prompt';
import { PROMPT_AI_LEAD_PROMPT } from './prompts/mode.prompt-ai-lead.prompt';
import { CODE_STANDARDS_GUARDIAN_PROMPT } from './prompts/mode.code-standards-guardian.prompt';
import { RELEASE_MANAGER_PROMPT } from './prompts/mode.release-manager.prompt';
import { SRE_INCIDENTS_PROMPT } from './prompts/mode.sre-incidents.prompt';

export { MASTER_PROMPT, ORIGINAL_MASTER_PROMPT_V1 };

export const MODE_PROMPTS = {
  ARCHITECTURE_REFACTORING: ARCHITECTURE_REFACTORING_PROMPT,
  BACKEND_SECURITY: BACKEND_SECURITY_PROMPT,
  FRONTEND_UX: FRONTEND_UX_PROMPT,
  DATA_OBSERVABILITY: DATA_OBSERVABILITY_PROMPT,
  TESTING_QA: TESTING_QA_PROMPT,
  DEVOPS_PERFORMANCE: DEVOPS_PERFORMANCE_PROMPT,
  DOCS_DX: DOCS_DX_PROMPT,
  PRODUCT_WORKFLOWS: PRODUCT_WORKFLOWS_PROMPT,
  DB_ARCHITECT: DB_ARCHITECT_PROMPT,
  PROMPT_AI_LEAD: PROMPT_AI_LEAD_PROMPT,
  CODE_STANDARDS_GUARDIAN: CODE_STANDARDS_GUARDIAN_PROMPT,
  RELEASE_MANAGER: RELEASE_MANAGER_PROMPT,
  SRE_INCIDENTS: SRE_INCIDENTS_PROMPT
} as const;

export type AgentMode = keyof typeof MODE_PROMPTS;
