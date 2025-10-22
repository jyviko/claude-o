import { GlobalClaudeOrchestrator } from '../src/lib/orchestrator';
import { ClaudeTools } from '../src/lib/tools';

const orchestrator = new GlobalClaudeOrchestrator();
const tools = new ClaudeTools();

const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'spawn':
    case 's':
      handleSpawn(args);
      break;
      
    case 'check':
    case 'c':
      orchestrator.checkProjectTasks();
      break;
      
    case 'list':
    case 'l':
      orchestrator.listAllTasks();
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

    case 'tool':
      await handleTool(args);
      break;

    default:
      showHelp();
  }
}

function handleSpawn(args: string[]) {
  const [taskName, ...descParts] = args;
  const description = descParts.join(' ');

  if (!taskName || !description) {
    console.error('Usage: co spawn <task-name> <description>');
    process.exit(1);
  }

  orchestrator.spawnTask(taskName, description);
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
Claude Orchestrator v1.0.0

Usage:
  co spawn <name> <description>      - Spawn new task
  co check                           - Check & merge completed tasks
  co list                            - List all tasks globally
  co merge <task-id|task-name>       - Manually merge a task
  co kill <task-id|task-name>        - Kill/delete a task
  co nuke --confirm                  - ERASE ALL TASKS (requires --confirm)

Shortcuts:
  co s = spawn
  co c = check
  co l = list
  co m = merge
  co k = kill

Examples:
  co spawn fix-auth "Fix authentication refresh token"
  co spawn update-ui "Update dashboard layout" main
  co check
  co list
  co merge 4681ae30        (preferred: use task ID from list)
  co merge fix-auth        (also works with task name)
  co kill 4681ae30
  co nuke --confirm

Note: Use 'co list' to see task IDs. Prefer IDs over names to avoid ambiguity.
      Merge only merges - it does NOT run tests or builds. Handle that yourself.
`);
}

main().catch(console.error);