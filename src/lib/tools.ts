import { GlobalClaudeOrchestrator } from './orchestrator';
import { ClaudeToolCall } from './types';

// This file handles Claude tool integration
export class ClaudeTools {
  private orchestrator: GlobalClaudeOrchestrator;
  
  constructor() {
    this.orchestrator = new GlobalClaudeOrchestrator();
  }
  
  async handleToolCall(toolCall: ClaudeToolCall): Promise<any> {
    switch (toolCall.name) {
      case 'spawn_task':
        return this.spawnTask(toolCall.arguments);
      
      case 'check_tasks':
        return this.checkTasks();
      
      case 'list_tasks':
        return this.listTasks();
      
      default:
        throw new Error(`Unknown tool: ${toolCall.name}`);
    }
  }
  
  private async spawnTask(args: ClaudeToolCall['arguments']) {
    try {
      const task = this.orchestrator.spawnTask(
        args.name,
        args.description,
        { baseBranch: args.baseBranch, project: args.project }
      );
      
      return {
        success: true,
        message: `Spawned task ${args.name} in isolated worktree`,
        taskId: task.id,
        worktreePath: task.worktreePath,
        branch: task.branch
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  private async checkTasks() {
    const results = this.orchestrator.checkProjectTasks();
    return {
      success: true,
      checked: results.checked,
      completed: results.completed,
      merged: results.merged
    };
  }
  
  private async listTasks() {
    const tasks = this.orchestrator.getCurrentProjectTasks();
    return {
      success: true,
      tasks
    };
  }
}

// Export tool definitions for Claude
export const CLAUDE_TOOL_DEFINITIONS = [
  {
    name: "spawn_task",
    description: "Create an isolated git worktree and spawn another Claude instance to work on a specific task",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short identifier for the task (e.g., 'fix-auth-bug')"
        },
        description: {
          type: "string",
          description: "Detailed description of what needs to be done"
        },
        baseBranch: {
          type: "string",
          description: "Base branch to create worktree from (default: 'develop')"
        }
      },
      required: ["name", "description"]
    }
  },
  {
    name: "check_tasks",
    description: "Check for completed tasks and merge them back",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_tasks",
    description: "List all active tasks for the current project",
    input_schema: {
      type: "object",
      properties: {}
    }
  }
];