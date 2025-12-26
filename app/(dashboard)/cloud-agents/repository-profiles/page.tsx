/**
 * Repository Profiles Management Page
 * 
 * Create and manage repository safety profiles
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { RepositoryProfile } from '@/features/cloud-agents/types/repository-profile';

export default function RepositoryProfilesPage() {
  const [profiles, setProfiles] = useState<RepositoryProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<RepositoryProfile | null>(null);

  const [formData, setFormData] = useState({
    repository: '',
    name: '',
    description: '',
    allowedBranches: ['*'],
    protectedBranches: ['main', 'master', 'production'],
    defaultBranch: 'main',
    protectedPaths: [] as string[],
    allowedPaths: [] as string[],
    requiredChecks: ['lint', 'test'],
    minTestCoverage: 80
  });

  useEffect(() => {
    void loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      const response = await fetch('/api/cloud-agents/repository-profiles');
      if (!response.ok) throw new Error('Failed to load profiles');
      
      const data = await response.json();
      setProfiles(data.data.profiles || []);
    } catch (error) {
      console.error('Failed to load profiles', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const url = editingProfile
        ? `/api/cloud-agents/repository-profiles/${editingProfile.id}`
        : '/api/cloud-agents/repository-profiles';
      
      const method = editingProfile ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to save profile');
      
      await loadProfiles();
      setShowForm(false);
      setEditingProfile(null);
      resetForm();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save profile');
    }
  };

  const resetForm = () => {
    setFormData({
      repository: '',
      name: '',
      description: '',
      allowedBranches: ['*'],
      protectedBranches: ['main', 'master', 'production'],
      defaultBranch: 'main',
      protectedPaths: [],
      allowedPaths: [],
      requiredChecks: ['lint', 'test'],
      minTestCoverage: 80
    });
  };

  const handleEdit = (profile: RepositoryProfile) => {
    setEditingProfile(profile);
    setFormData({
      repository: profile.repository,
      name: profile.name,
      description: profile.description || '',
      allowedBranches: profile.allowedBranches,
      protectedBranches: profile.protectedBranches,
      defaultBranch: profile.defaultBranch || 'main',
      protectedPaths: profile.protectedPaths,
      allowedPaths: profile.allowedPaths || [],
      requiredChecks: profile.requiredChecks,
      minTestCoverage: profile.minTestCoverage || 80
    });
    setShowForm(true);
  };

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link 
              href="/cloud-agents" 
              className="text-muted-foreground hover:text-foreground mb-2 inline-block"
            >
              ← Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold">Repository Profiles</h1>
            <p className="text-muted-foreground mt-2">
              Configure safety policies for each repository
            </p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setEditingProfile(null);
              setShowForm(true);
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            + New Profile
          </button>
        </div>

        {showForm && (
          <section className="bg-card p-6 rounded-lg border mb-6">
            <h2 className="text-xl font-semibold mb-4">
              {editingProfile ? 'Edit Profile' : 'New Profile'}
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Repository URL *</label>
                <input
                  type="text"
                  required
                  value={formData.repository}
                  onChange={(e) => setFormData({ ...formData, repository: e.target.value })}
                  placeholder="https://github.com/user/repo"
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Profile Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Auto-filled from repository"
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Allowed Branches</label>
                  <input
                    type="text"
                    value={formData.allowedBranches.join(', ')}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      allowedBranches: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    placeholder="feature/*, develop, *"
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use * for all branches, or patterns like feature/*
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Protected Branches</label>
                  <input
                    type="text"
                    value={formData.protectedBranches.join(', ')}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      protectedBranches: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    placeholder="main, master, production"
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Protected Paths</label>
                <input
                  type="text"
                  value={formData.protectedPaths.join(', ')}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    protectedPaths: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="infra/, db/migrations/, .github/"
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Paths that cannot be modified by agents
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Required Checks</label>
                <input
                  type="text"
                  value={formData.requiredChecks.join(', ')}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    requiredChecks: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="lint, test, type-check"
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                />
              </div>

              <div className="flex gap-4">
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                >
                  {editingProfile ? 'Update' : 'Create'} Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingProfile(null);
                    resetForm();
                  }}
                  className="px-4 py-2 border rounded-lg hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {loading ? (
          <div className="text-center py-12">Loading...</div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No profiles yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Create Your First Profile
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {profiles.map((profile) => (
              <div key={profile.id} className="bg-card p-6 rounded-lg border">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2">{profile.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{profile.repository}</p>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <strong>Allowed Branches:</strong> {profile.allowedBranches.join(', ')}
                      </div>
                      <div>
                        <strong>Protected Branches:</strong> {profile.protectedBranches.join(', ')}
                      </div>
                      <div>
                        <strong>Protected Paths:</strong> {profile.protectedPaths.length > 0 ? profile.protectedPaths.join(', ') : 'None'}
                      </div>
                      <div>
                        <strong>Required Checks:</strong> {profile.requiredChecks.join(', ')}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleEdit(profile)}
                    className="px-4 py-2 border rounded-lg hover:bg-muted"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
