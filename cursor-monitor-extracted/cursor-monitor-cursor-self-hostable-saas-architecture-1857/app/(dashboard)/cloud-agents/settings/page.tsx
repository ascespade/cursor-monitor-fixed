/**
 * Cloud Agents Settings Page
 *
 * Purpose:
 * - Provide UI for managing Cursor Cloud Agents API configurations.
 * - Supports adding, editing, and deleting API configs with color coding.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  addApiConfig,
  updateApiConfig,
  deleteApiConfig,
  getAllApiConfigs,
  getAllApiConfigsSync,
  loadEnvVarApiKey,
  maskApiKey,
  type ApiConfig
} from '@/features/cloud-agents/services/api-config-manager.service';
import { fetchCloudAgentUserInfo } from '@/features/cloud-agents/services/cloud-agents.service';
import { EmptyState } from '@/shared/components/EmptyState';

type HealthStatus = 'ok' | 'warning' | 'error';

interface HealthCheckResult {
  status: HealthStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface CloudAgentsHealthResponse {
  cursorApi: HealthCheckResult;
  redisQueue: HealthCheckResult;
  orchestrator: HealthCheckResult;
  environment: {
    cursorApiKeyConfigured: boolean;
    redisHostConfigured: boolean;
    redisPortConfigured: boolean;
  };
}

export default function CloudAgentsSettingsPage() {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<Omit<ApiConfig, 'id' | 'color'> & { githubToken?: string }>({
    name: '',
    description: '',
    apiKey: '',
    githubToken: ''
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<CloudAgentsHealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    void loadConfigs();
  }, []);

  const loadConfigs = async (): Promise<void> => {
    // First set sync configs (localStorage + cached env var)
    setConfigs(getAllApiConfigsSync());
    
    // Then try to load env var from server if not in cache
    await loadEnvVarApiKey();
    
    // Reload configs to include server-side env var if found
    const configs = await getAllApiConfigs();
    setConfigs(configs);
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.apiKey.trim()) {
      alert('Name and API Key are required');
      return;
    }

    if (editingId) {
      const updated = updateApiConfig(editingId, formData);
      if (updated) {
        // Save GitHub token to localStorage
        if (formData.githubToken && typeof window !== 'undefined') {
          localStorage.setItem(`github_token_${editingId}`, formData.githubToken);
        }
        loadConfigs();
        resetForm();
      }
    } else {
      const newConfig = addApiConfig(formData);
      // Save GitHub token to localStorage
      if (newConfig && formData.githubToken && typeof window !== 'undefined') {
        localStorage.setItem(`github_token_${newConfig.id}`, formData.githubToken);
      }
      loadConfigs();
      resetForm();
    }
  };

  const handleRunHealthChecks = async (): Promise<void> => {
    setHealthLoading(true);
    setHealthError(null);
    setHealthResult(null);

    try {
      const response = await fetch('/api/cloud-agents/health', {
        method: 'GET'
      });

      const json = await response.json() as
        | { success: true; data: CloudAgentsHealthResponse }
        | { success: false; error: { message: string } };

      if ('success' in json && json.success) {
        setHealthResult(json.data);
      } else {
        const message = json && 'error' in json && json.error?.message
          ? json.error.message
          : 'Unknown error while running health checks';
        setHealthError(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run connection tests';
      setHealthError(message);
    } finally {
      setHealthLoading(false);
    }
  };

  const handleEdit = (config: ApiConfig): void => {
    // Cannot edit env var config
    if (config._isEnvVar) return;
    
    setEditingId(config.id);
    // Try to load GitHub token from localStorage if exists
    const githubToken = typeof window !== 'undefined' ? localStorage.getItem(`github_token_${config.id}`) || '' : '';
    setFormData({
      name: config.name,
      description: config.description ?? '',
      apiKey: config.apiKey,
      githubToken
    });
    setShowAddForm(true);
  };

  const handleDelete = (id: string): void => {
    if (confirm('Are you sure you want to delete this API configuration?')) {
      deleteApiConfig(id);
      loadConfigs();
      if (editingId === id) {
        resetForm();
      }
    }
  };

  const resetForm = (): void => {
    setFormData({ name: '', description: '', apiKey: '', githubToken: '' });
    setEditingId(null);
    setShowAddForm(false);
    setTestResult(null);
  };

  const handleTestApiKey = async (): Promise<void> => {
    if (!formData.apiKey.trim()) {
      setTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const info = await fetchCloudAgentUserInfo({ apiKey: formData.apiKey });
      setTestResult({
        success: true,
        message: `✅ API key is valid! Connected as: ${info.apiKeyName ?? 'Unknown'}${info.userEmail ? ` (${info.userEmail})` : ''}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setTestResult({
        success: false,
        message: `❌ API key test failed: ${message}`
      });
    } finally {
      setTesting(false);
    }
  };

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
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Settings</h1>
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
          </div>
        </div>
      </header>

      <div className="p-6 relative z-10">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          {/* Add/Edit Form */}
        {showAddForm && (
          <section className="border border-border rounded-xl bg-card-raised p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {editingId ? 'Edit API Configuration' : 'Add New API Configuration'}
              </h2>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g., Personal API, Team API"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Cursor API Key <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    required
                    value={formData.apiKey}
                    onChange={(e) => {
                      setFormData({ ...formData, apiKey: e.target.value });
                      setTestResult(null); // Clear test result when API key changes
                    }}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="cur_xxxxxxxxxxxx or key_xxxxxxxxxxxx"
                  />
                  <button
                    type="button"
                    onClick={handleTestApiKey}
                    disabled={testing || !formData.apiKey.trim()}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-emerald-700 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {testing ? 'Testing...' : 'Test'}
                  </button>
                </div>
                {testResult && (
                  <p className={`mt-2 text-xs ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.message}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Your API key is stored locally in your browser (localStorage). Click &quot;Test&quot; to verify before saving.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  <strong>Note:</strong> You can also set <code className="bg-slate-900 px-1 py-0.5 rounded">CURSOR_API_KEY</code> or <code className="bg-slate-900 px-1 py-0.5 rounded">NEXT_PUBLIC_CURSOR_API_KEY</code> as environment variable.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  GitHub Token (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={formData.githubToken || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, githubToken: e.target.value });
                    }}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="ghp_xxxxxxxxxxxx"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  GitHub token for accessing private repositories and fetching branches. Optional but recommended.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  <strong>Note:</strong> You can also set <code className="bg-slate-900 px-1 py-0.5 rounded">GITHUB_TOKEN</code> or <code className="bg-slate-900 px-1 py-0.5 rounded">NEXT_PUBLIC_GITHUB_TOKEN</code> as environment variable.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-card-raised transition-smooth"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover transition-smooth"
                >
                  {editingId ? 'Update' : 'Add'} Configuration
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Configurations List */}
        <section className="border border-border rounded-xl bg-card-raised p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">API Configurations</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Manage Cursor API keys and GitHub tokens for repository access
              </p>
            </div>
            {!showAddForm && (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover transition-smooth"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add API
              </button>
            )}
          </div>

          {configs.length === 0 && !showAddForm && (
            <EmptyState
              icon={
                <svg className="w-16 h-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
              title="No API configurations"
              description="Add your first Cursor API key to start using Cloud Agents. You can add multiple API keys and switch between them."
              primaryAction={{
                label: 'Add Your First API',
                onClick: () => setShowAddForm(true)
              }}
            />
          )}

          {configs.length > 0 && (
            <div className="space-y-3">
              {configs.map((config) => (
                <div
                  key={config.id}
                  className="border border-border rounded-lg bg-card p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: config.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-foreground">{config.name}</h3>
                        <span className="text-xs font-mono text-muted-foreground">#{config.id.slice(-8)}</span>
                      </div>
                      {config.description && (
                        <p className="text-xs text-muted-foreground mb-2">{config.description}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">
                          {config._masked ? maskApiKey(config.apiKey) : `${config.apiKey.slice(0, 8)}...`}
                        </span>
                        {config._isEnvVar && (
                          <>
                            <span className="text-xs px-2 py-0.5 rounded-full border border-primary/50 bg-primary/20 text-primary">
                              Environment Variable
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                setTesting(true);
                                setTestResult(null);
                                try {
                                  const info = await fetchCloudAgentUserInfo({ apiKey: config.apiKey });
                                  setTestResult({
                                    success: true,
                                    message: `✅ API key is valid! Connected as: ${info.apiKeyName ?? 'Unknown'}${info.userEmail ? ` (${info.userEmail})` : ''}`
                                  });
                                } catch (error) {
                                  const message = error instanceof Error ? error.message : 'Unknown error';
                                  setTestResult({
                                    success: false,
                                    message: `❌ API key test failed: ${message}`
                                  });
                                } finally {
                                  setTesting(false);
                                }
                              }}
                              disabled={testing}
                              className="px-2 py-1 text-xs font-medium rounded-lg border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                            >
                              {testing ? 'Testing...' : 'Test'}
                            </button>
                          </>
                        )}
                        <span
                          className="text-xs px-2 py-0.5 rounded-full border"
                          style={{
                            color: config.color,
                            borderColor: config.color,
                            backgroundColor: `${config.color}20`
                          }}
                        >
                          Color ID
                        </span>
                      </div>
                      {config._isEnvVar && testResult && (
                        <p className={`mt-2 text-xs ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {testResult.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!config._isEnvVar && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEdit(config)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card-raised text-foreground hover:bg-card transition-smooth"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(config.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-700 bg-red-950/40 text-red-400 hover:bg-red-950/60 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {config._isEnvVar && (
                      <span className="text-xs text-muted-foreground italic">
                        Read-only (from environment variable)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Connection Diagnostics + Info Section */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Connection Diagnostics */}
          <section className="border border-border rounded-xl bg-card-raised p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Connection Diagnostics</h2>
                <p className="text-[0.7rem] text-muted-foreground">
                  Run tests to verify that Cursor API, Redis queue, and the orchestrator wiring are configured correctly.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { void handleRunHealthChecks(); }}
                disabled={healthLoading}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-smooth whitespace-nowrap"
              >
                {healthLoading ? 'Running…' : 'Run connection tests'}
              </button>
            </div>

            {healthError && (
              <p className="text-xs text-red-400 mt-2">
                ❌ {healthError}
              </p>
            )}

            {healthResult && (
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground mb-1">Cursor API</p>
                  <ConnectionStatusBadge result={healthResult.cursorApi} />
                  {healthResult.cursorApi.details && (
                    <p className="mt-1 text-muted-foreground">
                      {(healthResult.cursorApi.details as any).apiKeyName && (
                        <>Key: <span className="font-mono">{String((healthResult.cursorApi.details as any).apiKeyName)}</span>{' '}</>
                      )}
                      {(healthResult.cursorApi.details as any).userEmail && (
                        <>• {String((healthResult.cursorApi.details as any).userEmail)}</>
                      )}
                    </p>
                  )}
                </div>

                <div>
                  <p className="font-semibold text-foreground mb-1">Redis Queue (Vercel → Orchestrator)</p>
                  <ConnectionStatusBadge result={healthResult.redisQueue} />
                  {healthResult.redisQueue.details && (
                    <p className="mt-1 text-muted-foreground">
                      Host: <span className="font-mono">{String((healthResult.redisQueue.details as any).host)}</span>{' '}
                      • Port: <span className="font-mono">{String((healthResult.redisQueue.details as any).port)}</span>
                    </p>
                  )}
                </div>

                <div>
                  <p className="font-semibold text-foreground mb-1">Local Orchestrator Worker</p>
                  <ConnectionStatusBadge result={healthResult.orchestrator} />
                  <p className="mt-1 text-muted-foreground">
                    This check only verifies that jobs reach Redis from Vercel.  
                    Full worker status is monitored on the local server via PM2.
                  </p>
                </div>

                <div className="border border-border rounded-lg bg-card p-2 mt-1 space-y-1">
                  <p className="text-[0.7rem] font-semibold text-foreground">Environment Summary</p>
                  <ul className="text-[0.7rem] text-muted-foreground space-y-0.5">
                    <li>
                      CURSOR_API_KEY:{' '}
                      <span className={healthResult.environment.cursorApiKeyConfigured ? 'text-emerald-400' : 'text-red-400'}>
                        {healthResult.environment.cursorApiKeyConfigured ? 'configured' : 'missing'}
                      </span>
                    </li>
                    <li>
                      REDIS_HOST:{' '}
                      <span className={healthResult.environment.redisHostConfigured ? 'text-emerald-400' : 'text-red-400'}>
                        {healthResult.environment.redisHostConfigured ? 'configured' : 'missing'}
                      </span>
                    </li>
                    <li>
                      REDIS_PORT:{' '}
                      <span className={healthResult.environment.redisPortConfigured ? 'text-emerald-400' : 'text-red-400'}>
                        {healthResult.environment.redisPortConfigured ? 'configured' : 'missing'}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {!healthResult && !healthError && !healthLoading && (
              <p className="mt-2 text-[0.7rem] text-muted-foreground">
                No diagnostics run yet. Click &quot;Run connection tests&quot; to verify the setup.
              </p>
            )}
          </section>

          {/* Info Section */}
          <section className="border border-border rounded-xl bg-card-raised p-4 sm:p-6 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">About API Configurations</h2>
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                Each API configuration is assigned a unique color for easy visual identification in the dashboard.
                You can add multiple APIs and filter agents by their associated API key.
              </p>
              <p>
                <strong>Testing API Keys:</strong> Use the &quot;Test&quot; button next to the API key field to verify
                that your key is valid before saving. This will check connectivity and retrieve your account information.
              </p>
              <div className="border border-border rounded-lg bg-card p-3 mt-3">
                <h3 className="text-xs font-semibold text-foreground mb-2">🔔 Webhook Notifications</h3>
                <p className="text-xs text-muted-foreground mb-2">
                  This app includes a webhook endpoint to receive real-time notifications from Cursor Cloud Agents API.
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  <strong>Webhook URL:</strong>{' '}
                  <code className="bg-card-raised px-1 py-0.5 rounded text-foreground">
                    https://your-domain.com/api/cloud-agents/webhook
                  </code>
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  <strong>Currently Supported Events:</strong>
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1 mb-2 ml-2">
                  <li>
                    <code className="bg-card-raised px-1 py-0.5 rounded text-accent">statusChange</code> - Triggered when agent status changes to FINISHED or ERROR
                  </li>
                  <li className="text-muted-foreground italic">
                    Note: Message notifications are not currently supported by Cursor API, but the endpoint is prepared for future event types
                  </li>
                </ul>
                <p className="text-xs text-muted-foreground mb-1">
                  <strong>Webhook Payload Includes:</strong>
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5 mb-2 ml-2">
                  <li>Agent ID and status</li>
                  <li>Summary/description of the agent&apos;s work</li>
                  <li>Repository and branch information</li>
                  <li>Pull Request URL (if applicable)</li>
                  <li>Timestamp and event metadata</li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Configure this URL in your Cursor dashboard settings. Supports Slack integration (optional) if{' '}
                  <code className="bg-card-raised px-1 py-0.5 rounded text-foreground">SLACK_WEBHOOK_URL</code> environment variable is configured.
                </p>
              </div>
              <p className="text-muted-foreground">
                <strong>Note:</strong> API keys are stored locally in your browser&apos;s localStorage.
                For production use, consider using environment variables or a secure backend storage solution.
              </p>
            </div>
          </section>
          </div>
        </div>
      </div>
    </main>
  );
}

interface ConnectionStatusBadgeProps {
  result: HealthCheckResult;
}

function ConnectionStatusBadge({ result }: ConnectionStatusBadgeProps): JSX.Element {
  const colorClasses =
    result.status === 'ok'
      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
      : result.status === 'warning'
        ? 'border-amber-700/60 bg-amber-950/40 text-amber-300'
        : 'border-red-700/60 bg-red-950/40 text-red-300';

  const label =
    result.status === 'ok'
      ? 'Healthy'
      : result.status === 'warning'
        ? 'Warning'
        : 'Error';

  return (
    <div className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.7rem] font-medium ${colorClasses}`}>
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            result.status === 'ok'
              ? 'bg-emerald-400'
              : result.status === 'warning'
                ? 'bg-amber-400'
                : 'bg-red-400'
          }`}
        />
        {label}
      </span>
      <span className="text-[0.7rem] text-muted-foreground">{result.message}</span>
    </div>
  );
}

