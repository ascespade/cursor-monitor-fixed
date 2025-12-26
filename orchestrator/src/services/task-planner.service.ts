/**
 * Task Planner Service
 * 
 * Splits large prompts into manageable subtasks
 * Uses AI to intelligently break down complex projects
 */

import { logger } from '../utils/logger';

const CURSOR_API_BASE = 'https://api.cursor.com/v0';

export interface Task {
  id: string;
  title: string;
  description: string;
  dependencies: string[]; // IDs of tasks that must complete first
  priority: 'high' | 'medium' | 'low';
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export interface TaskPlan {
  projectDescription: string;
  tasks: Task[];
  totalTasks: number;
  estimatedDuration: string;
}

class TaskPlannerService {
  /**
   * Get API key dynamically from process.env
   * This allows the API key to be set after the service is instantiated
   */
  private getApiKey(): string {
    const apiKey = process.env['CURSOR_API_KEY'];
    if (!apiKey) {
      throw new Error('AUTH_FAILED: CURSOR_API_KEY is not set in process.env');
    }
    return apiKey;
  }

  /**
   * Plan tasks from large prompt
   */
  async planTasks(largePrompt: string, repository: string): Promise<TaskPlan> {
    try {
      logger.info('Planning tasks from large prompt', { 
        promptLength: largePrompt.length,
        repository 
      });

      // Build planning prompt
      const planningPrompt = this.buildPlanningPrompt(largePrompt, repository);

      // Call Cursor API to generate task plan
      const plan = await this.generatePlanWithAPI(planningPrompt);

      logger.info('Task plan generated', { 
        totalTasks: plan.tasks.length,
        repository 
      });

      return plan;
    } catch (error) {
      logger.error('Task planning failed, using fallback', { error });
      return this.fallbackPlan(largePrompt);
    }
  }

  /**
   * Build planning prompt for AI
   */
  private buildPlanningPrompt(largePrompt: string, repository: string): string {
    return `You are a senior software architect. Your task is to break down a large project description into manageable, sequential subtasks.

**Project Description:**
${largePrompt}

**Repository:** ${repository}

**Your Task:**
Analyze the project description and create a detailed task plan. Each task should be:
1. **Specific and actionable** - Clear what needs to be done
2. **Testable** - Can verify completion
3. **Independent** - Can be worked on separately (with dependencies noted)
4. **Appropriately sized** - Not too large (max 2-3 hours of work)

**Task Categories:**
- Setup/Configuration
- Core Features
- Testing
- Documentation
- Refactoring/Optimization
- Integration

**Response Format (JSON only):**
{
  "projectDescription": "Brief summary of the project",
  "tasks": [
    {
      "id": "task-1",
      "title": "Task title",
      "description": "Detailed description of what needs to be done",
      "dependencies": ["task-0"], // IDs of tasks that must complete first
      "priority": "high|medium|low",
      "estimatedComplexity": "simple|moderate|complex"
    }
  ],
  "totalTasks": 5,
  "estimatedDuration": "2-3 days"
}

**Important:**
- Order tasks logically (setup first, then features, then testing)
- Mark dependencies clearly
- Ensure all aspects of the project are covered
- Include testing tasks for each major feature
- Include documentation tasks where needed`;
  }

  /**
   * Generate plan using Cursor API
   */
  private async generatePlanWithAPI(prompt: string): Promise<TaskPlan> {
    try {
      const response = await fetch(`${CURSOR_API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.getApiKey()}:`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-4.5-opus-high-thinking',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`Cursor API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || data.content || '{}';

      return this.extractPlan(content);
    } catch (error) {
      logger.error('Cursor API planning failed', { error });
      throw error;
    }
  }

  /**
   * Extract plan from API response
   */
  private extractPlan(content: string): TaskPlan {
    try {
      // Try to parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonText);

      // Validate and structure tasks
      const tasks: Task[] = (parsed.tasks || []).map((t: any, index: number) => ({
        id: t.id || `task-${index + 1}`,
        title: t.title || `Task ${index + 1}`,
        description: t.description || '',
        dependencies: t.dependencies || [],
        priority: t.priority || 'medium',
        estimatedComplexity: t.estimatedComplexity || 'moderate'
      }));

      return {
        projectDescription: parsed.projectDescription || 'Project implementation',
        tasks,
        totalTasks: tasks.length,
        estimatedDuration: parsed.estimatedDuration || 'Unknown'
      };
    } catch (error) {
      logger.error('Failed to extract plan', { error, content });
      throw error;
    }
  }

  /**
   * Fallback plan (simple breakdown)
   */
  private fallbackPlan(largePrompt: string): TaskPlan {
    // Simple rule-based breakdown
    const lines = largePrompt.split('\n').filter(l => l.trim().length > 0);
    const chunks = [];
    
    // Split into chunks of ~500 words
    let currentChunk = '';
    for (const line of lines) {
      if (currentChunk.length + line.length > 500 && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    const tasks: Task[] = chunks.map((chunk, index) => ({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      description: chunk.substring(0, 200) + (chunk.length > 200 ? '...' : ''),
      dependencies: index > 0 ? [`task-${index}`] : [],
      priority: index === 0 ? 'high' : 'medium',
      estimatedComplexity: 'moderate'
    }));

    return {
      projectDescription: largePrompt.substring(0, 200) + '...',
      tasks,
      totalTasks: tasks.length,
      estimatedDuration: `${tasks.length * 2}-${tasks.length * 3} hours`
    };
  }

  /**
   * Get next task to execute (respects dependencies)
   */
  getNextTask(plan: TaskPlan, completedTaskIds: string[]): Task | null {
    for (const task of plan.tasks) {
      // Check if task is already completed
      if (completedTaskIds.includes(task.id)) {
        continue;
      }

      // Check if all dependencies are completed
      const allDependenciesMet = task.dependencies.every(depId => 
        completedTaskIds.includes(depId)
      );

      if (allDependenciesMet) {
        return task;
      }
    }

    return null;
  }

  /**
   * Get all tasks that can run in parallel (all dependencies met, not already running)
   */
  getParallelizableTasks(
    plan: TaskPlan,
    completedTaskIds: string[],
    runningTaskIds: string[],
    maxParallel: number = 3
  ): Task[] {
    const availableTasks: Task[] = [];

    for (const task of plan.tasks) {
      // Skip if already completed
      if (completedTaskIds.includes(task.id)) {
        continue;
      }

      // Skip if already running
      if (runningTaskIds.includes(task.id)) {
        continue;
      }

      // Check if all dependencies are completed
      const allDependenciesMet = task.dependencies.every(depId => 
        completedTaskIds.includes(depId)
      );

      if (allDependenciesMet) {
        availableTasks.push(task);
      }
    }

    // Sort by priority (high first) and return up to maxParallel
    return availableTasks
      .sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      })
      .slice(0, maxParallel);
  }

  /**
   * Build dependency graph for visualization and analysis
   */
  buildDependencyGraph(plan: TaskPlan): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const task of plan.tasks) {
      graph.set(task.id, task.dependencies);
    }

    return graph;
  }

  /**
   * Check if tasks can run in parallel (no shared dependencies or conflicts)
   */
  canRunInParallel(task1: Task, task2: Task): boolean {
    // If tasks share dependencies, they might conflict
    const sharedDeps = task1.dependencies.filter(dep => 
      task2.dependencies.includes(dep)
    );

    // If one task depends on the other, can't run parallel
    if (task1.dependencies.includes(task2.id) || 
        task2.dependencies.includes(task1.id)) {
      return false;
    }

    // Check for resource conflicts (same files/modules)
    // This is a simplified check - in production, analyze file paths
    const task1Files = this.extractFileReferences(task1.description);
    const task2Files = this.extractFileReferences(task2.description);
    
    const sharedFiles = task1Files.filter(f => task2Files.includes(f));
    
    // If they modify the same files, might conflict
    // But allow if they're just reading (simplified logic)
    return sharedFiles.length === 0 || 
           (!task1.description.toLowerCase().includes('modify') && 
            !task2.description.toLowerCase().includes('modify'));
  }

  /**
   * Extract file references from task description (simplified)
   */
  private extractFileReferences(description: string): string[] {
    // Simple regex to find file paths
    const filePattern = /[\w\/\-\.]+\.(ts|tsx|js|jsx|py|java|cpp|h|hpp|go|rs|rb|php|sql|md|json|yaml|yml)/gi;
    const matches = description.match(filePattern) || [];
    return [...new Set(matches)]; // Remove duplicates
  }
}

export const taskPlanner = new TaskPlannerService();
