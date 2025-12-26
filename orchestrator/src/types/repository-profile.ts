/**
 * Repository Profile Types (copied from main app for orchestrator use)
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

  // Check branch protection
  if (task.branch) {
    // Check if branch is protected
    if (profile.protectedBranches.some(protectedBranch => {
      if (protectedBranch.includes('*')) {
        return task.branch === protectedBranch.replace('*', '');
      }
      return task.branch === protectedBranch || task.branch?.startsWith(protectedBranch);
    })) {
      errors.push(`Branch ${task.branch} is protected and cannot be modified`);
    }

    // Check if branch is allowed
    if (profile.allowedBranches.length > 0 && !profile.allowedBranches.includes('*')) {
      const isAllowed = profile.allowedBranches.some(allowed => {
        if (allowed.includes('*')) {
          const pattern = allowed.replace('*', '');
          return task.branch?.startsWith(pattern);
        }
        return task.branch === allowed;
      });
      if (!isAllowed) {
        errors.push(`Branch ${task.branch} is not in allowed branches list`);
      }
    }
  }

  // Check path protection
  if (task.files && task.files.length > 0) {
    for (const file of task.files) {
      // Check protected paths
      if (profile.protectedPaths.some(protectedPath => file.startsWith(protectedPath))) {
        errors.push(`File ${file} is in a protected path`);
      }

      // Check allowed paths (if specified)
      if (profile.allowedPaths && profile.allowedPaths.length > 0) {
        const isAllowed = profile.allowedPaths.some(allowed => file.startsWith(allowed));
        if (!isAllowed) {
          errors.push(`File ${file} is not in allowed paths list`);
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
