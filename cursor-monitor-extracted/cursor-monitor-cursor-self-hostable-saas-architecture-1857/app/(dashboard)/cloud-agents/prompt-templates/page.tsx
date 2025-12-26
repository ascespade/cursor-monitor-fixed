/**
 * Prompt Templates Management Page
 * 
 * Create, edit, and manage prompt templates
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getAllPromptTemplates,
  savePromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  type PromptTemplate
} from '@/features/cloud-agents/services/prompt-templates.service';
import { EmptyState } from '@/shared/components/EmptyState';

export default function PromptTemplatesPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'custom' as PromptTemplate['category'],
    prompt: '',
    variables: [] as string[],
    tags: [] as string[]
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = () => {
    const allTemplates = getAllPromptTemplates();
    setTemplates(allTemplates);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: 'custom',
      prompt: '',
      variables: [],
      tags: []
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (template: PromptTemplate) => {
    setFormData({
      name: template.name,
      description: template.description,
      category: template.category,
      prompt: template.prompt,
      variables: template.variables || [],
      tags: template.tags || []
    });
    setEditingId(template.id);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingId) {
      const updated = updatePromptTemplate(editingId, formData);
      if (updated) {
        loadTemplates();
        resetForm();
      }
    } else {
      savePromptTemplate(formData);
      loadTemplates();
      resetForm();
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      deletePromptTemplate(id);
      loadTemplates();
    }
  };

  const extractVariables = (prompt: string): string[] => {
    const matches = prompt.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
  };

  const handlePromptChange = (value: string) => {
    setFormData({
      ...formData,
      prompt: value,
      variables: extractVariables(value)
    });
  };

  return (
    <div className="h-full w-full p-4 sm:p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="mb-6">
          <Link 
            href="/cloud-agents/orchestrate" 
            className="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block"
          >
            ← Back to Orchestrate
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Prompt Templates</h1>
              <p className="text-sm text-muted-foreground">
                Create and manage reusable prompt templates for your orchestrations
              </p>
            </div>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Template
              </button>
            )}
          </div>
        </header>

        {/* Form */}
        {showForm && (
          <section className="bg-card p-4 sm:p-6 rounded-lg border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {editingId ? 'Edit Template' : 'Create New Template'}
              </h2>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                    placeholder="Template name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Category *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as PromptTemplate['category'] })}
                    className="w-full px-4 py-2 bg-background border rounded-lg"
                  >
                    <option value="feature">Feature</option>
                    <option value="refactor">Refactor</option>
                    <option value="bugfix">Bug Fix</option>
                    <option value="documentation">Documentation</option>
                    <option value="testing">Testing</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 bg-background border rounded-lg"
                  placeholder="Brief description of this template"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Prompt Template *</label>
                <textarea
                  required
                  value={formData.prompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  className="w-full px-4 py-3 bg-background border rounded-lg min-h-[200px] resize-y font-mono text-sm"
                  placeholder="Enter your prompt template. Use {{variableName}} for variables."
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use <code className="bg-card-raised px-1 py-0.5 rounded">{'{{variableName}}'}</code> for variables
                </p>
              </div>

              {formData.variables.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Detected Variables</label>
                  <div className="flex flex-wrap gap-2">
                    {formData.variables.map((variable) => (
                      <span
                        key={variable}
                        className="px-2 py-1 bg-primary/10 text-primary rounded text-xs font-mono"
                      >
                        {`{{${variable}}}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium"
                >
                  {editingId ? 'Update Template' : 'Create Template'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 border border-border bg-card text-foreground rounded-lg hover:bg-card-raised"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Templates List */}
        {templates.length === 0 && !showForm ? (
          <EmptyState
            icon={
              <svg className="w-16 h-16 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            }
            title="No templates yet"
            description="Create reusable prompt templates to speed up your orchestration setup. Templates can include variables that you can fill in later."
            primaryAction={{
              label: 'Create Your First Template',
              onClick: () => setShowForm(true)
            }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-card p-4 rounded-lg border border-border hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1">{template.name}</h3>
                    <p className="text-xs text-muted-foreground mb-2">{template.description}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">
                        {template.category}
                      </span>
                      {template.usageCount && template.usageCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Used {template.usageCount} time{template.usageCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleEdit(template)}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded border border-border bg-card text-foreground hover:bg-card-raised transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded border border-red-700/50 bg-red-950/30 text-red-300 hover:bg-red-900/50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
