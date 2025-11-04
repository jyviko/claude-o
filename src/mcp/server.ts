#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GlobalClaudeOrchestrator } from '../lib/orchestrator';

const orchestrator = new GlobalClaudeOrchestrator();

// Create the server
const server = new Server(
  {
    name: 'claude-o',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'spawn_task',
        description:
          'Create an isolated git worktree and spawn a separate Claude CLI instance to work on a specific task in parallel. Use this to delegate independent sub-tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Short identifier for the task (e.g., "fix-auth-bug", "add-tests")',
            },
            description: {
              type: 'string',
              description: 'Detailed description of what needs to be done',
            },
            baseBranch: {
              type: 'string',
              description: 'Base branch to create worktree from (optional, defaults to "develop")',
            },
          },
          required: ['name', 'description'],
        },
      },
      {
        name: 'list_tasks',
        description: 'List all active and recently completed tasks across all projects',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'check_tasks',
        description:
          'Check all active tasks for completion and automatically merge completed ones back to the base branch',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'merge_task',
        description: 'Manually merge a specific task back to its base branch. Use list_tasks to get task IDs. Just merges - does not run tests or builds.',
        inputSchema: {
          type: 'object',
          properties: {
            taskNameOrId: {
              type: 'string',
              description: 'Task ID (preferred, e.g. "4681ae30") or task name. Use list_tasks to see task IDs.',
            },
          },
          required: ['taskNameOrId'],
        },
      },
      {
        name: 'close_task',
        description: 'Mark a task as completed without deleting the worktree or branch. Use this when you have manually implemented a task. The task can still be merged later.',
        inputSchema: {
          type: 'object',
          properties: {
            taskNameOrId: {
              type: 'string',
              description: 'Task ID (preferred, e.g. "4681ae30") or task name. Use list_tasks to see task IDs.',
            },
          },
          required: ['taskNameOrId'],
        },
      },
      {
        name: 'send_command',
        description: 'Send a command to a task\'s tmux session. Useful for coordinating tasks, sending new instructions to Claude, or running commands in spawned task terminals.',
        inputSchema: {
          type: 'object',
          properties: {
            taskNameOrId: {
              type: 'string',
              description: 'Task ID (preferred, e.g. "4681ae30") or task name. Use list_tasks to see task IDs.',
            },
            command: {
              type: 'string',
              description: 'The command to send to the task\'s tmux session. This will be typed and submitted automatically.',
            },
          },
          required: ['taskNameOrId', 'command'],
        },
      },
      {
        name: 'kill_task',
        description: 'Kill and remove a specific task, deleting its worktree and branch. Use list_tasks to get task IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            taskNameOrId: {
              type: 'string',
              description: 'Task ID (preferred, e.g. "4681ae30") or task name. Use list_tasks to see task IDs.',
            },
          },
          required: ['taskNameOrId'],
        },
      },
      {
        name: 'send_command',
        description: 'Send a command to a task\'s tmux session. Use this to communicate with or orchestrate tasks. For example: check status, run tests, provide feedback, or intervene when a task deviates from expectations.',
        inputSchema: {
          type: 'object',
          properties: {
            taskNameOrId: {
              type: 'string',
              description: 'Task ID (preferred, e.g. "4681ae30") or task name. Use list_tasks to see task IDs.',
            },
            command: {
              type: 'string',
              description: 'Command or message to send to the task. This will be typed into the AI assistant\'s terminal.',
            },
          },
          required: ['taskNameOrId', 'command'],
        },
      },
      {
        name: 'read_session_output',
        description: 'Read the terminal output from a task\'s tmux session. Use this to monitor progress, check for errors, or see what the AI is currently doing. You should actively monitor tasks and intervene if you see deviations from the task description.',
        inputSchema: {
          type: 'object',
          properties: {
            taskNameOrId: {
              type: 'string',
              description: 'Task ID (preferred, e.g. "4681ae30") or task name. Use list_tasks to see task IDs.',
            },
            lines: {
              type: 'number',
              description: 'Number of lines to read from the end of the output (default: 100)',
            },
          },
          required: ['taskNameOrId'],
        },
      },
      {
        name: 'list_sessions',
        description: 'List all active tmux sessions for running tasks, showing which sessions are running or terminated.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'spawn_task': {
        const { name: taskName, description, baseBranch } = args as {
          name: string;
          description: string;
          baseBranch?: string;
        };

        const task = orchestrator.spawnTask(taskName, description, {
          baseBranch,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  task: {
                    id: task.id,
                    name: task.taskName,
                    worktreePath: task.worktreePath,
                    branch: task.branch,
                    baseBranch: task.baseBranch,
                  },
                  message: `Task "${taskName}" spawned successfully. A new terminal should have opened with Claude.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'list_tasks': {
        // Capture console output
        const originalLog = console.log;
        let output = '';
        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };

        orchestrator.listAllTasks();

        console.log = originalLog;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'check_tasks': {
        const originalLog = console.log;
        const originalError = console.error;
        let output = '';

        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };
        console.error = (...errorArgs: any[]) => {
          output += 'ERROR: ' + errorArgs.join(' ') + '\n';
        };

        const result = orchestrator.checkProjectTasks();

        console.log = originalLog;
        console.error = originalError;

        return {
          content: [
            {
              type: 'text',
              text:
                output +
                `\n\nChecked: ${result.checked}, Completed: ${result.completed}, Merged: ${result.merged}`,
            },
          ],
        };
      }

      case 'merge_task': {
        const { taskNameOrId } = args as { taskNameOrId: string };

        const originalLog = console.log;
        const originalError = console.error;
        let output = '';

        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };
        console.error = (...errorArgs: any[]) => {
          output += 'ERROR: ' + errorArgs.join(' ') + '\n';
        };

        orchestrator.manualMerge(taskNameOrId);

        console.log = originalLog;
        console.error = originalError;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'close_task': {
        const { taskNameOrId } = args as { taskNameOrId: string };

        const originalLog = console.log;
        const originalError = console.error;
        let output = '';

        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };
        console.error = (...errorArgs: any[]) => {
          output += 'ERROR: ' + errorArgs.join(' ') + '\n';
        };

        orchestrator.closeTask(taskNameOrId);

        console.log = originalLog;
        console.error = originalError;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'send_command': {
        const { taskNameOrId, command } = args as { taskNameOrId: string; command: string };

        const originalLog = console.log;
        const originalError = console.error;
        let output = '';

        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };
        console.error = (...errorArgs: any[]) => {
          output += 'ERROR: ' + errorArgs.join(' ') + '\n';
        };

        orchestrator.sendCommandToTask(taskNameOrId, command);

        console.log = originalLog;
        console.error = originalError;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'kill_task': {
        const { taskNameOrId } = args as { taskNameOrId: string };

        const originalLog = console.log;
        const originalError = console.error;
        let output = '';

        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };
        console.error = (...errorArgs: any[]) => {
          output += 'ERROR: ' + errorArgs.join(' ') + '\n';
        };

        orchestrator.killTask(taskNameOrId);

        console.log = originalLog;
        console.error = originalError;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'send_command': {
        const { taskNameOrId, command } = args as { taskNameOrId: string; command: string };

        const originalLog = console.log;
        const originalError = console.error;
        let output = '';

        console.log = (...logArgs: any[]) => {
          output += logArgs.join(' ') + '\n';
        };
        console.error = (...errorArgs: any[]) => {
          output += 'ERROR: ' + errorArgs.join(' ') + '\n';
        };

        orchestrator.sendCommandToTask(taskNameOrId, command);

        console.log = originalLog;
        console.error = originalError;

        return {
          content: [
            {
              type: 'text',
              text: output || `Command sent to task ${taskNameOrId}: ${command}`,
            },
          ],
        };
      }

      case 'read_session_output': {
        const { taskNameOrId, lines } = args as { taskNameOrId: string; lines?: number };

        const output = orchestrator.readSessionOutput(taskNameOrId, lines || 100);

        return {
          content: [
            {
              type: 'text',
              text: output || '(No output)',
            },
          ],
        };
      }

      case 'list_sessions': {
        const sessions = orchestrator.listActiveSessions();

        let output = '📺 Active Task Sessions:\n\n';

        if (sessions.length === 0) {
          output += 'No active task sessions found.\n';
        } else {
          sessions.forEach(session => {
            const statusIcon = session.status === 'running' ? '🟢' : '🔴';
            output += `${statusIcon} ${session.taskName} [${session.taskId}]\n`;
            output += `   Session: ${session.session}\n`;
            output += `   Status: ${session.status}\n\n`;
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claude Orchestrator MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
