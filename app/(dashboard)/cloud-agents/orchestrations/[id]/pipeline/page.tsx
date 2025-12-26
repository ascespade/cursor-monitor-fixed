/**
 * Pipeline Visualization Page
 * 
 * Shows task dependency graph and execution timeline
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { TaskDetail } from '@/features/cloud-agents/types/tasks';

export default function PipelineVisualizationPage() {
  const params = useParams();
  const id = params['id'] as string;
  
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadTasks = async () => {
    try {
      const response = await fetch(`/api/cloud-agents/orchestrate/${id}/tasks`);
      if (!response.ok) throw new Error('Failed to load tasks');
      
      const data = await response.json();
      setTasks(data.data.tasks || []);
    } catch (error) {
      console.error('Failed to load tasks', error);
    } finally {
      setLoading(false);
    }
  };

  // Build dependency graph
  const buildGraph = (tasks: TaskDetail[]) => {
    const nodes = tasks.map(task => ({
      id: task.id,
      label: task.title,
      status: task.status,
      priority: task.priority
    }));

    const edges = tasks.flatMap(task =>
      task.dependencies.map(depId => ({
        from: depId,
        to: task.id
      }))
    );

    return { nodes, edges };
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">Loading...</div>
      </main>
    );
  }

  const { nodes, edges } = buildGraph(tasks);

  // Group tasks by status for timeline
  const tasksByStatus = {
    completed: tasks.filter(t => t.status === 'completed'),
    running: tasks.filter(t => t.status === 'running'),
    pending: tasks.filter(t => t.status === 'pending'),
    failed: tasks.filter(t => t.status === 'failed')
  };

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <Link 
            href={`/cloud-agents/orchestrations/${id}`}
            className="text-muted-foreground hover:text-foreground mb-2 inline-block"
          >
            ← Back to Details
          </Link>
          <h1 className="text-3xl font-bold">Pipeline Visualization</h1>
        </div>

        {/* Simple Graph View */}
        <section className="bg-card p-6 rounded-lg border mb-6">
          <h2 className="text-xl font-semibold mb-4">Task Dependency Graph</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tasks.map((task) => {
              const dependencies = tasks.filter(t => task.dependencies.includes(t.id));
              const dependents = tasks.filter(t => t.dependencies.includes(task.id));

              return (
                <div
                  key={task.id}
                  className={`p-4 border-2 rounded-lg ${
                    task.status === 'completed' ? 'border-green-500 bg-green-500/10' :
                    task.status === 'running' ? 'border-blue-500 bg-blue-500/10' :
                    task.status === 'failed' ? 'border-red-500 bg-red-500/10' :
                    'border-muted bg-muted/10'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-medium text-sm">{task.title}</h3>
                    <span className={`px-2 py-1 rounded text-xs ${
                      task.priority === 'high' ? 'bg-red-500/20 text-red-500' :
                      task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                  
                  <div className="text-xs text-muted-foreground space-y-1">
                    {dependencies.length > 0 && (
                      <div>
                        <strong>Depends on:</strong> {dependencies.map(d => d.title).join(', ')}
                      </div>
                    )}
                    {dependents.length > 0 && (
                      <div>
                        <strong>Blocks:</strong> {dependents.map(d => d.title).join(', ')}
                      </div>
                    )}
                    {task.status === 'running' && task.agentId && (
                      <div>
                        <strong>Agent:</strong> <code className="text-xs">{task.agentId.slice(0, 8)}...</code>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Timeline View */}
        <section className="bg-card p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-4">Execution Timeline</h2>
          
          <div className="space-y-4">
            {tasksByStatus.completed.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-green-500 mb-2">
                  ✅ Completed ({tasksByStatus.completed.length})
                </h3>
                <div className="space-y-2">
                  {tasksByStatus.completed.map(task => (
                    <div key={task.id} className="p-3 bg-green-500/10 border border-green-500/20 rounded">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{task.title}</span>
                        {task.completedAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(task.completedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasksByStatus.running.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-blue-500 mb-2">
                  🔄 Running ({tasksByStatus.running.length})
                </h3>
                <div className="space-y-2">
                  {tasksByStatus.running.map(task => (
                    <div key={task.id} className="p-3 bg-blue-500/10 border border-blue-500/20 rounded">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{task.title}</span>
                        {task.startedAt && (
                          <span className="text-xs text-muted-foreground">
                            Started: {new Date(task.startedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasksByStatus.pending.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  ⏳ Pending ({tasksByStatus.pending.length})
                </h3>
                <div className="space-y-2">
                  {tasksByStatus.pending.map(task => (
                    <div key={task.id} className="p-3 bg-muted/30 border border-muted rounded">
                      <span className="text-sm text-muted-foreground">{task.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasksByStatus.failed.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-red-500 mb-2">
                  ❌ Failed ({tasksByStatus.failed.length})
                </h3>
                <div className="space-y-2">
                  {tasksByStatus.failed.map(task => (
                    <div key={task.id} className="p-3 bg-red-500/10 border border-red-500/20 rounded">
                      <span className="text-sm">{task.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
