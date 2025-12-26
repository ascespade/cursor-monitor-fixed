/**
 * GET /api/cloud-agents/repository-profiles
 * POST /api/cloud-agents/repository-profiles
 *
 * Purpose:
 * - Manage repository profiles (safety policies)
 * - Store in Supabase or localStorage (for now, localStorage)
 */
import { NextResponse } from 'next/server';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../_utils/get-api-key';
import type { RepositoryProfile } from '@/features/cloud-agents/types/repository-profile';

// For now, store in memory (in production, use Supabase)
const profilesStore = new Map<string, RepositoryProfile>();

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const url = new URL(request.url);
    const repository = url.searchParams.get('repository');

    if (repository) {
      // Get specific profile
      const profile = Array.from(profilesStore.values()).find(
        p => p.repository === repository
      );
      
      if (!profile) {
        return ok(null);
      }
      
      return ok(profile);
    }

    // Get all profiles
    const profiles = Array.from(profilesStore.values());
    return ok({ profiles, total: profiles.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const body = (await request.json()) as Partial<RepositoryProfile>;

    if (!body.repository) {
      return handleApiError(new Error('repository is required'));
    }

    const profile: RepositoryProfile = {
      id: body.id || `profile-${Date.now()}`,
      repository: body.repository,
      name: body.name || body.repository.split('/').slice(-1)[0] || 'Unnamed Profile',
      description: body.description,
      allowedBranches: body.allowedBranches || ['*'],
      protectedBranches: body.protectedBranches || ['main', 'master', 'production'],
      defaultBranch: body.defaultBranch || 'main',
      protectedPaths: body.protectedPaths || [],
      allowedPaths: body.allowedPaths,
      requiredChecks: body.requiredChecks || ['lint', 'test'],
      minTestCoverage: body.minTestCoverage,
      maxAgentsPerOrchestration: body.maxAgentsPerOrchestration,
      maxExecutionHours: body.maxExecutionHours,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    profilesStore.set(profile.id, profile);

    return ok(profile);
  } catch (error) {
    return handleApiError(error);
  }
}
