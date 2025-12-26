/**
 * Repository Profile Types
 * 
 * Defines safety policies and constraints for each repository
 */

export interface RepositoryProfile {
  id: string;
  repository: string; // Full URL or owner/repo format
  name: string;
  description?: string;
  
  // Branch protection
  allowedBranches: string[]; // ['feature/*', 'develop'] or ['*'] for all
  protectedBranches: string[]; // ['main', 'master', 'production'] - never allow changes
  defaultBranch?: string; // 'main' or 'master'
  
  // Path protection
  protectedPaths: string[]; // ['infra/', 'db/migrations/', '.github/']
  allowedPaths?: string[]; // If set, only these paths can be modified
  
  // Quality requirements
  requiredChecks: string[]; // ['lint', 'test', 'type-check']
  minTestCoverage?: number; // 0-100
  
  // Limits
  maxAgentsPerOrchestration?: number;
  maxExecutionHours?: number;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate if a task can be executed on a repository based on profile
 */
export function validateTaskAgainstProfile(
  profile: RepositoryProfile,
  task: {
    branch?: string;
    files?: string[];
    description?: string;
  }
): ProfileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check branch
  if (task.branch) {
    // Check if branch is protected
    if (profile.protectedBranches.includes(task.branch)) {
      errors.push(`Branch '${task.branch}' is protected and cannot be modified`);
    }

    // Check if branch matches allowed pattern
    if (profile.allowedBranches.length > 0 && !profile.allowedBranches.includes('*')) {
      const isAllowed = profile.allowedBranches.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(task.branch || '');
        }
        return pattern === task.branch;
      });

      if (!isAllowed) {
        errors.push(`Branch '${task.branch}' is not in allowed list: ${profile.allowedBranches.join(', ')}`);
      }
    }
  }

  // Check paths
  if (task.files && task.files.length > 0) {
    // Check protected paths
    for (const file of task.files) {
      for (const protectedPath of profile.protectedPaths) {
        if (file.startsWith(protectedPath)) {
          errors.push(`File '${file}' is in protected path '${protectedPath}'`);
        }
      }
    }

    // Check allowed paths (if restricted)
    if (profile.allowedPaths && profile.allowedPaths.length > 0) {
      for (const file of task.files) {
        const isAllowed = profile.allowedPaths.some(path => file.startsWith(path));
        if (!isAllowed) {
          warnings.push(`File '${file}' is outside allowed paths`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
