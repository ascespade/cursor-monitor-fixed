/**
 * Orchestration Settings Page
 * 
 * UI for configuring orchestration options before starting
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { OrchestrationMode, OrchestrationOptions } from '@/features/cloud-agents/types/orchestration';
import { fetchCloudAgentRepositories, fetchCloudAgentModels } from '@/features/cloud-agents/services/cloud-agents.service';
import { getAllApiConfigs, getApiKeyForConfig, getAllApiConfigsSync } from '@/features/cloud-agents/services/api-config-manager.service';
import { AIPromptGenerator } from '@/features/cloud-agents/components/AIPromptGenerator';
import { 
  getAllPromptTemplates, 
  getPromptTemplateById, 
  renderTemplatePrompt,
  incrementTemplateUsage
} from '@/features/cloud-agents/services/prompt-templates.service';
import type { PromptTemplate } from '@/features/cloud-agents/types/prompt-templates';

export default function OrchestratePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Array<{ owner: string; name: string; repository: string }>>([]);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isValidatingRepo, setIsValidatingRepo] = useState(false);
  const [repoValidationError, setRepoValidationError] = useState<string | null>(null);
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  
  const [formData, setFormData] = useState({
    prompt: '',
    repository: '',
    ref: 'main',
    model: '',
    mode: 'AUTO' as OrchestrationMode,
    maxParallelAgents: 3,
    maxIterations: 20,
    enableAutoFix: true,
    enableTesting: true,
    enableValidation: true,
    taskSize: 'auto' as 'small' | 'medium' | 'large' | 'auto',
    priority: 'balanced' as 'speed' | 'quality' | 'balanced'
  });

  // Load API key, repositories, models, and templates
  useEffect(() => {
    void (async () => {
      try {
        const configs = await getAllApiConfigs();
        const firstConfig = configs[0];
        if (firstConfig) {
          const key = getApiKeyForConfig(firstConfig);
          if (key) {
            setApiKey(key);
            const [repos, models] = await Promise.all([
              fetchCloudAgentRepositories({ apiKey: key }),
              fetchCloudAgentModels({ apiKey: key }).catch((error) => {
                console.warn('Failed to fetch models from API, using fallback', error);
                // Fallback to default model if API fails
                return { models: ['claude-4.5-opus-high-thinking'] };
              })
            ]);
            setRepositories(repos.repositories ?? []);
            setAvailableModels(models.models ?? []);
          }
        }
        // Load prompt templates
        const templates = getAllPromptTemplates();
        setPromptTemplates(templates);
      } catch {
        // Fail silently
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    // Validate required fields
    if (!formData.prompt.trim()) {
      setError('Project prompt is required');
      setLoading(false);
      return;
    }

    if (!formData.repository.trim()) {
      setError('Repository is required');
      setLoading(false);
      return;
    }

    const formatCheck = validateRepositoryFormat(formData.repository);
    if (!formatCheck.valid) {
      setError(formatCheck.error || 'Invalid repository format');
      setLoading(false);
      return;
    }

    try {
      const options: Partial<OrchestrationOptions> = {
        mode: formData.mode,
        maxParallelAgents: formData.mode === 'BATCH' ? formData.maxParallelAgents : undefined,
        maxIterations: formData.maxIterations,
        enableAutoFix: formData.enableAutoFix,
        enableTesting: formData.enableTesting,
        enableValidation: formData.enableValidation,
        taskSize: formData.taskSize,
        priority: formData.priority
      };

      // Log submission details for debugging
      // eslint-disable-next-line no-console
      console.log('Submitting orchestration:', {
        repository: formData.repository,
        promptLength: formData.prompt.length,
        mode: formData.mode
      });

      const response = await fetch('/api/cloud-agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: formData.prompt,
          repository: formData.repository,
          ref: formData.ref,
          model: formData.model || null, // null = Auto mode (let API choose)
          options
        })
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        let errorMessage = 'Failed to start orchestration';
        
        // Try to extract error message from different response formats
        if (responseData && typeof responseData === 'object') {
          // Format: { success: false, error: "message" }
          if (typeof responseData.error === 'string') {
            errorMessage = responseData.error;
          }
          // Format: { error: { message: "..." } }
          else if (responseData.error && typeof responseData.error === 'object' && typeof responseData.error.message === 'string') {
            errorMessage = responseData.error.message;
          }
          // Format: { message: "..." }
          else if (typeof responseData.message === 'string') {
            errorMessage = responseData.message;
          }
          // Format: { data: "..." }
          else if (typeof responseData.data === 'string') {
            errorMessage = responseData.data;
          }
        }
        
        // If still no message, use status text
        if (errorMessage === 'Failed to start orchestration' && response.statusText) {
          errorMessage = `${errorMessage}: ${response.statusText}`;
      }

        // eslint-disable-next-line no-console
        console.error('Orchestration error:', { status: response.status, data: responseData });
        throw new Error(errorMessage);
      }

      // Check if response indicates success
      if (responseData.success === false) {
        const errorMsg = responseData.error || responseData.message || 'Failed to start orchestration';
        throw new Error(errorMsg);
      }

      // Extract jobId from response (could be in data.data.jobId or data.jobId)
      const jobId = responseData.data?.jobId || responseData.jobId || responseData.data?.id;
      
      if (!jobId) {
        console.error('No jobId in response:', responseData);
        throw new Error('Failed to start orchestration: No job ID returned');
      }
      
      setSuccess('Orchestration started successfully! Redirecting...');
      setTimeout(() => {
        router.push(`/cloud-agents/orchestrations`);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSuccess(null);
    } finally {
      setLoading(false);
    }
  };
  
  // Validate repository format
  const validateRepositoryFormat = (repo: string): { valid: boolean; error?: string } => {
    if (!repo.trim()) {
      return { valid: false, error: 'Repository is required' };
    }
    
    // Check if it's a valid GitHub URL or owner/repo format
    const githubUrlPattern = /^https?:\/\/(www\.)?github\.com\/[^\/]+\/[^\/]+(?:\/|\.git)?$/;
    const ownerRepoPattern = /^[^\/]+\/[^\/]+$/;
    
    if (githubUrlPattern.test(repo) || ownerRepoPattern.test(repo)) {
      return { valid: true };
    }
    
    return { valid: false, error: 'Invalid repository format. Use https://github.com/owner/repo or owner/repo' };
  };

  // Load branches for a repository
  const loadBranches = async (repo: string): Promise<void> => {
    if (!repo.trim() || !apiKey) {
      setBranches([]);
      return;
    }

    setLoadingBranches(true);
    try {
      // Normalize repository URL to owner/repo format
      let normalizedRepo = repo.trim();
      if (normalizedRepo.startsWith('http://') || normalizedRepo.startsWith('https://')) {
        const match = normalizedRepo.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (match) {
          normalizedRepo = `${match[1]}/${match[2]}`;
        }
      }

      // Use GitHub API to fetch branches
      const [owner, repoName] = normalizedRepo.split('/');
      if (!owner || !repoName) {
        setBranches([]);
        return;
      }

      // Get GitHub token from env, localStorage, or user input
      let githubToken: string | null = null;
      
      // Try environment variable first
      try {
        const tokenResponse = await fetch('/api/cloud-agents/configs/env/github-token');
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json() as { token?: string };
          githubToken = tokenData.token ?? null;
        }
      } catch {
        // Fail silently, will try localStorage
      }
      
      // If no env token, try localStorage (for user-configured tokens)
      // Note: We can't access primaryConfigId here, so we'll try common config IDs
      if (!githubToken && typeof window !== 'undefined') {
        // Try to get from any stored config
        const configs = getAllApiConfigsSync();
        for (const config of configs) {
          const storedToken = localStorage.getItem(`github_token_${config.id}`);
          if (storedToken) {
            githubToken = storedToken;
            break;
          }
        }
      }

      const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/branches`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          ...(githubToken ? { 'Authorization': `Bearer ${githubToken}` } : apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        }
      });

      if (response.ok) {
        const data = await response.json() as Array<{ name: string }>;
        const branchNames = data.map(b => b.name);
        setBranches(branchNames);
        // Set default branch if main/master exists
        if (branchNames.includes('main') && formData.ref === 'main') {
          // Keep main
        } else if (branchNames.includes('master') && formData.ref === 'main') {
          setFormData({ ...formData, ref: 'master' });
        } else if (branchNames.length > 0 && !branchNames.includes(formData.ref)) {
          const firstBranch = branchNames[0];
          if (firstBranch) {
            setFormData({ ...formData, ref: firstBranch });
          }
        }
      } else {
        // If GitHub API fails, use default branches
        setBranches(['main', 'master', 'develop']);
      }
    } catch (error) {
      // Fallback to common branch names
      setBranches(['main', 'master', 'develop']);
    } finally {
      setLoadingBranches(false);
    }
  };

  // Validate repository accessibility
  const validateRepositoryAccess = async (repo: string): Promise<{ valid: boolean; error?: string }> => {
    const formatCheck = validateRepositoryFormat(repo);
    if (!formatCheck.valid) {
      return formatCheck;
    }

    setIsValidatingRepo(true);
    setRepoValidationError(null);

    try {
      // Normalize repository URL
      let normalizedRepo = repo.trim();
      if (normalizedRepo.startsWith('http://') || normalizedRepo.startsWith('https://')) {
        // Extract owner/repo from URL
        const match = normalizedRepo.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (match) {
          normalizedRepo = `${match[1]}/${match[2]}`;
        }
      }

      // Check if repository exists in user's repositories list
      const existsInList = repositories.some(r => r.repository === normalizedRepo || r.repository === repo);
      if (existsInList) {
        setIsValidatingRepo(false);
        // Load branches when repository is validated
        await loadBranches(repo);
        return { valid: true };
      }

      // If not in list, try to validate via API (optional - can be added later)
      // For now, if format is valid, we accept it
      setIsValidatingRepo(false);
      // Load branches even if not in list
      await loadBranches(repo);
      return { valid: true };
    } catch (error) {
      setIsValidatingRepo(false);
      return { valid: false, error: 'Failed to validate repository. Please check if the repository exists and is accessible.' };
    }
  };
  
  const searchQuery = repoSearchQuery || formData.repository || '';
  const filteredRepositories = repositories.filter((repo) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      repo.repository.toLowerCase().includes(q) ||
      repo.name.toLowerCase().includes(q) ||
      repo.owner.toLowerCase().includes(q)
    );
  });

  return (
    <main className="min-h-screen bg-background">
      <header className="flex-shrink-0 px-4 py-3 border-b border-border bg-card-raised/80 backdrop-blur-md shadow-elevation-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full animate-ping opacity-75"></div>
              <div className="relative w-3 h-3 bg-primary rounded-full"></div>
            </div>
            <div>
              <p className="text-xs font-mono text-muted-foreground mb-0.5">Cursor Cloud Monitor</p>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Start Orchestration</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/cloud-agents"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Dashboard
            </Link>
            <Link
              href="/cloud-agents/orchestrations"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Orchestrations
            </Link>
            <Link
              href="/cloud-agents/settings"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </Link>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <p className="text-muted-foreground mb-8">
              Configure autonomous task orchestration for large projects
            </p>
          </div>

            {error && (
            <div className="mb-6 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-6 p-4 bg-green-950/30 border border-green-700/50 rounded-lg text-green-300">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <section className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Project Details</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Repository *
                </label>
                <div className="space-y-2">
                  {/* Search input - shown first when repositories exist */}
                  {repositories.length > 0 && (
                    <div className="relative">
                      <input
                        type="text"
                        className="w-full px-4 py-2 bg-background border rounded-lg"
                        placeholder="Search repositories or enter URL manually..."
                        value={formData.repository}
                        onChange={async (e) => {
                          const value = e.target.value;
                          
                          // Always update formData.repository for form submission
                          setFormData({ ...formData, repository: value });
                          
                          // Update search query for filtering dropdown
                          setRepoSearchQuery(value);
                          
                          // If user types a full URL or owner/repo format, validate it
                          const formatCheck = validateRepositoryFormat(value);
                          if (formatCheck.valid) {
                            setShowRepoDropdown(false);
                            // Validate accessibility
                            await validateRepositoryAccess(value);
                          } else {
                            setShowRepoDropdown(true);
                          }
                        }}
                        onFocus={() => {
                          if (filteredRepositories.length > 0) {
                            setShowRepoDropdown(true);
                          }
                        }}
                        onBlur={() => setTimeout(() => setShowRepoDropdown(false), 200)}
                      />
                      {showRepoDropdown && filteredRepositories.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                          {filteredRepositories.map((repo) => (
                            <button
                              key={repo.repository}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-card-raised focus:bg-card-raised focus:outline-none"
                              onClick={() => {
                                setFormData({ ...formData, repository: repo.repository });
                                setRepoSearchQuery('');
                                setShowRepoDropdown(false);
                                void validateRepositoryAccess(repo.repository);
                              }}
                            >
                              <div className="font-medium">{repo.repository}</div>
                              <div className="text-xs text-muted-foreground">{repo.owner}/{repo.name}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Manual input - shown when no repositories or as fallback */}
                  {repositories.length === 0 && (
                    <div className="relative">
                <input
                  type="text"
                  required
                  value={formData.repository}
                        onChange={async (e) => {
                          const value = e.target.value;
                          setFormData({ ...formData, repository: value });
                          if (value.trim()) {
                            await validateRepositoryAccess(value);
                          }
                        }}
                        placeholder="https://github.com/user/repo or user/repo"
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
                    </div>
                  )}

                  {/* Validation feedback */}
                  {isValidatingRepo && (
                    <p className="text-xs text-muted-foreground">
                      ⏳ Validating repository...
                    </p>
                  )}
                  {formData.repository && !isValidatingRepo && (
                    <>
                      {!validateRepositoryFormat(formData.repository).valid && (
                        <p className="mt-1 text-xs text-destructive">
                          {validateRepositoryFormat(formData.repository).error}
                        </p>
                      )}
                      {validateRepositoryFormat(formData.repository).valid && !repoValidationError && (
                        <p className="text-xs text-green-400">
                          ✓ Valid repository format
                        </p>
                      )}
                      {repoValidationError && (
                        <p className="mt-1 text-xs text-destructive">
                          {repoValidationError}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Branch</label>
                  {loadingBranches ? (
                    <div className="w-full px-4 py-2 bg-background border rounded-lg text-muted-foreground text-sm">
                      Loading branches...
                    </div>
                  ) : branches.length > 0 ? (
                    <select
                      value={formData.ref}
                      onChange={(e) => setFormData({ ...formData, ref: e.target.value })}
                      className="w-full px-4 py-2 bg-background border rounded-lg"
                    >
                      {branches.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={formData.ref}
                      onChange={(e) => setFormData({ ...formData, ref: e.target.value })}
                      placeholder="main"
                      className="w-full px-4 py-2 bg-background border rounded-lg"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Model</label>
                  <select
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                  >
                    <option value="">Auto (Let system choose)</option>
                    {availableModels.length > 0 ? (
                      availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))
                    ) : (
                      <>
                        {/* Fallback models if API fails to load */}
                        <option value="claude-4.5-opus-high-thinking">claude-4.5-opus-high-thinking</option>
                        <option value="gpt-5.2">gpt-5.2</option>
                        <option value="gpt-5.2-high">gpt-5.2-high</option>
                        <option value="gemini-3-pro">gemini-3-pro</option>
                        <option value="gemini-3-flash">gemini-3-flash</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium">
                    Project Prompt (3000+ lines recommended) *
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                      className="text-xs px-3 py-1.5 border border-border bg-card text-foreground rounded-lg hover:bg-card-raised transition-colors"
                      title="Load from template"
                    >
                      <svg className="w-3.5 h-3.5 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Templates
                    </button>
                    <AIPromptGenerator
                      currentPrompt={formData.prompt}
                      onEnhanced={(enhanced) => setFormData({ ...formData, prompt: enhanced })}
                      context={{
                        repository: formData.repository,
                        projectType: 'software-development'
                      }}
                      apiKey={apiKey}
                    />
                  </div>
                </div>
                
                {/* Template Selector */}
                {showTemplateSelector && (
                  <div className="mb-3 p-3 bg-card-raised border border-border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-foreground">Prompt Templates</h4>
                      <button
                        type="button"
                        onClick={() => setShowTemplateSelector(false)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {promptTemplates.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">No templates available</p>
                      ) : (
                        promptTemplates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => {
                              setSelectedTemplate(template);
                              // Render template with default variables (user can edit after)
                              const rendered = renderTemplatePrompt(template, {});
                              setFormData({ ...formData, prompt: rendered });
                              incrementTemplateUsage(template.id);
                              setShowTemplateSelector(false);
                            }}
                            className="w-full text-left p-2 rounded border border-border hover:bg-card hover:border-primary/50 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-foreground truncate">{template.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{template.description}</div>
                              </div>
                              <span className="ml-2 px-1.5 py-0.5 text-[0.65rem] bg-primary/10 text-primary rounded">
                                {template.category}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
                <textarea
                  required
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder="Describe your project in detail..."
                  rows={15}
                  className="w-full px-4 py-2 bg-background border rounded-lg font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  {formData.prompt.length} characters
                </p>
              </div>
            </div>
          </section>

          {/* Orchestration Mode */}
          <section className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Execution Mode</h2>
            
            <div className="space-y-3">
              {[
                { value: 'SINGLE_AGENT', label: 'Single Agent', desc: 'Send full prompt to one agent, monitor until complete' },
                { value: 'PIPELINE', label: 'Pipeline (Sequential)', desc: 'Tasks execute one after another' },
                { value: 'BATCH', label: 'Batch (Parallel)', desc: 'Multiple agents work simultaneously' },
                { value: 'AUTO', label: 'Auto', desc: 'System decides best approach' }
              ].map((mode) => (
                <label key={mode.value} className="flex items-start p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="mode"
                    value={mode.value}
                    checked={formData.mode === mode.value}
                    onChange={(e) => setFormData({ ...formData, mode: e.target.value as OrchestrationMode })}
                    className="mt-1 mr-3"
                  />
                  <div>
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-sm text-muted-foreground">{mode.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {formData.mode === 'BATCH' && (
              <div className="mt-4">
                <label className="block text-sm font-medium mb-2">
                  Max Parallel Agents
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.maxParallelAgents}
                  onChange={(e) => setFormData({ ...formData, maxParallelAgents: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
              </div>
            )}
          </section>

          {/* Advanced Options */}
          <section className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Advanced Options</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Task Size</label>
                  <select
                    value={formData.taskSize}
                    onChange={(e) => setFormData({ ...formData, taskSize: e.target.value as any })}
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                  >
                    <option value="auto">Auto</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                  >
                    <option value="balanced">Balanced</option>
                    <option value="speed">Speed</option>
                    <option value="quality">Quality</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Max Iterations</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={formData.maxIterations}
                  onChange={(e) => setFormData({ ...formData, maxIterations: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.enableAutoFix}
                    onChange={(e) => setFormData({ ...formData, enableAutoFix: e.target.checked })}
                    className="mr-2"
                  />
                  Enable Auto-Fix (automatically fix errors)
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.enableTesting}
                    onChange={(e) => setFormData({ ...formData, enableTesting: e.target.checked })}
                    className="mr-2"
                  />
                  Enable Testing (run tests after completion)
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.enableValidation}
                    onChange={(e) => setFormData({ ...formData, enableValidation: e.target.checked })}
                    className="mr-2"
                  />
                  Enable Validation (validate each task)
                </label>
              </div>
            </div>
          </section>

          <div className="flex gap-4">
            <button
              type="button"
              onClick={async () => {
                try {
                  setLoading(true);
                  const options: Partial<OrchestrationOptions> = {
                    mode: formData.mode,
                    maxParallelAgents: formData.mode === 'BATCH' ? formData.maxParallelAgents : undefined,
                    maxIterations: formData.maxIterations,
                    enableAutoFix: formData.enableAutoFix,
                    enableTesting: formData.enableTesting,
                    enableValidation: formData.enableValidation,
                    taskSize: formData.taskSize,
                    priority: formData.priority
                  };

                  const response = await fetch('/api/cloud-agents/orchestrate/dry-run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      prompt: formData.prompt,
                      repository: formData.repository,
                      ref: formData.ref,
                      model: formData.model,
                      options
                    })
                  });

                  if (!response.ok) throw new Error('Dry run failed');
                  
                  const data = await response.json();
                  alert(`Dry Run Complete!\n\nTasks: ${data.data.taskPlan?.totalTasks || 0}\nEstimated Duration: ${data.data.estimatedDuration}\n\nFull details available in response.`);
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Dry run failed');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading || !formData.prompt || !formData.repository}
              className="px-6 py-3 border border-primary text-primary rounded-lg font-medium hover:bg-primary/10 disabled:opacity-50"
            >
              🔍 Dry Run
            </button>
            <button
              type="submit"
              disabled={loading || !formData.prompt.trim() || !formData.repository.trim() || !validateRepositoryFormat(formData.repository).valid || isValidatingRepo || !!repoValidationError}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Starting...' : 'Start Orchestration'}
            </button>
            <Link
              href="/cloud-agents"
              className="px-6 py-3 border rounded-lg hover:bg-muted"
            >
              Cancel
            </Link>
          </div>
        </form>
        </div>
      </div>
    </main>
  );
}
