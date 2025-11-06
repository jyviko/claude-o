import { GlobalClaudeOrchestrator } from '../src/lib/orchestrator';
import { ClaudeTools } from '../src/lib/tools';

const orchestrator = new GlobalClaudeOrchestrator();
const tools = new ClaudeTools();

const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'spawn':
    case 's':
      await handleSpawn(args);
      break;
      
    case 'check':
    case 'c':
      orchestrator.checkProjectTasks();
      break;

    case 'list':
    case 'l':
      handleList(args);
      break;

    case 'clean':
      handleClean(args);
      break;

    case 'close':
      handleClose(args);
      break;

    case 'kill':
    case 'k':
      handleKill(args);
      break;

    case 'merge':
    case 'm':
      handleMerge(args);
      break;

    case 'nuke':
      handleNuke(args);
      break;

    case 'send':
    case 'x':
      handleSend(args);
      break;

    case 'tool':
      await handleTool(args);
      break;

    default:
      showHelp();
  }
}

async function handleSpawn(args: string[]) {
  const [taskName, ...descParts] = args;
  let description = descParts.join(' ');

  // If no description provided via args, try reading from stdin
  if (!description && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    description = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!taskName || !description) {
    console.error('Usage: co spawn <task-name> <description>');
    console.error('       cat task-file | co spawn <task-name>');
    process.exit(1);
  }

  orchestrator.spawnTask(taskName, description);
}

function handleList(args: string[]) {
  const scope = args[0] || 'current';
  orchestrator.listAllTasks(scope);
}

function handleClean(args: string[]) {
  const scope = args[0] || 'current';
  orchestrator.cleanCompletedTasks(scope);
}

function handleClose(args: string[]) {
  const [taskName] = args;

  if (!taskName) {
    console.error('Usage: co close <task-id|task-name>');
    console.error('Example: co close 4681ae30  (preferred: use task ID from co list)');
    console.error('');
    console.error('This marks a task as completed without deleting the worktree.');
    console.error('Use this when you have manually implemented the task.');
    process.exit(1);
  }

  orchestrator.closeTask(taskName);
}

function handleKill(args: string[]) {
  const [taskName] = args;

  if (!taskName) {
    console.error('Usage: co kill <task-id|task-name>');
    console.error('Example: co kill 4681ae30  (preferred: use task ID from co list)');
    process.exit(1);
  }

  orchestrator.killTask(taskName);
}

function handleMerge(args: string[]) {
  const taskName = args[0];

  if (!taskName) {
    console.error('Usage: co merge <task-id|task-name>');
    console.error('Example: co merge 4681ae30  (preferred: use task ID from co list)');
    process.exit(1);
  }

  orchestrator.manualMerge(taskName);
}

function handleNuke(args: string[]) {
  // Require explicit confirmation
  const confirmation = args[0];
  const projectPath = args[1];

  if (confirmation !== '--confirm') {
    console.error('⚠️  DANGER: This will erase ALL tasks for the specified project!');
    console.error('');
    console.error('Usage: co nuke --confirm [project-path]');
    console.error('');
    console.error('This will:');
    console.error('  - Remove all worktrees');
    console.error('  - Delete all branches');
    console.error('  - Erase all task records');
    console.error('');
    console.error('If project-path is not provided, uses current directory.');
    console.error('');
    process.exit(1);
  }

  orchestrator.nukeAllTasks(projectPath);
}

function handleSend(args: string[]) {
  const [taskNameOrId, ...commandParts] = args;

  if (!taskNameOrId || commandParts.length === 0) {
    console.error('Usage: co send <task-id|task-name> <command>');
    console.error('Example: co send 4681ae30 "npm test"');
    console.error('');
    console.error('This sends a command to the tmux session running the task.');
    console.error('Useful for coordinating commands across parallel tasks.');
    process.exit(1);
  }

  const command = commandParts.join(' ');
  orchestrator.sendCommandToTask(taskNameOrId, command);
}

async function handleTool(args: string[]) {
  const toolCall = {
    name: args[0],
    arguments: JSON.parse(args.slice(1).join(' '))
  };
  
  const result = await tools.handleToolCall(toolCall);
  console.log(JSON.stringify(result));
}

function showHelp() {
  console.log(`
AI Task Orchestrator v1.0.0

Usage:
  co spawn <name> <description>      Spawn new task
  co check                           Check & merge completed tasks
  co list [all|<project-name>]       List tasks (default: current repo only)
  co clean [all|<project-name>]      Clean completed/merged task worktrees
  co close <task-id|task-name>       Mark task complete (keeps worktree)
  co merge <task-id|task-name>       Manually merge a task
  co kill <task-id|task-name>        Kill/delete a task permanently
  co send <task-id> <command>        Send command to task's tmux session
  co nuke --confirm                  ERASE ALL TASKS (requires --confirm)

Shortcuts:
  s, spawn      Spawn new task
  c, check      Check & merge tasks
  l, list       List tasks
  m, merge      Merge task
  k, kill       Kill task
  x, send       Send command to task

List Command:
  co list              List tasks for current repo only
  co list all          List tasks for all repos
  co list <project>    List tasks for specific project

Clean Command:
  co clean             Clean completed tasks for current repo
  co clean all         Clean completed tasks from all repos
  co clean <project>   Clean completed tasks for specific project

Examples:
  co spawn fix-auth "Fix authentication refresh token"
  co list                  # Current repo tasks only
  co list all              # All tasks from all projects
  co list my-project       # Tasks from specific project
  co clean                 # Clean completed tasks (current repo)
  co clean all             # Clean all completed tasks (all repos)
  co send 4681ae30 "npm test"         # Send command + Enter to task
  co x 4681ae30 "run tests"           # Shortcut for send
  co close 4681ae30        # Mark complete, keeps worktree/branch
  co merge 4681ae30        # Merge to base branch
  co kill 4681ae30         # Delete everything permanently

Send Command:
  Sends command text followed by Enter key to task's tmux session.
  Useful for: coordinating tasks, sending new instructions, running tests.
  Example: co send 4681ae30 "Also add error handling for edge cases"

Command Comparison:
  close    Stops task, keeps worktree/branch for later merge
  merge    Merges branch to base (no tests/builds run)
  kill     Deletes worktree, branch, and all records permanently

Note: Use task IDs from 'co list' to avoid ambiguity.
      Tasks can be merged later with 'co merge <task-id>'.
`);
}

main().catch(console.error);