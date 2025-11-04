"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("../src/lib/orchestrator");
const tools_1 = require("../src/lib/tools");
const orchestrator = new orchestrator_1.GlobalClaudeOrchestrator();
const tools = new tools_1.ClaudeTools();
const [, , command, ...args] = process.argv;
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
            handleSend(args);
            break;
        case 'tool':
            await handleTool(args);
            break;
        default:
            showHelp();
    }
}
function handleSpawn(args) {
    const [taskName, ...descParts] = args;
    const description = descParts.join(' ');
    if (!taskName || !description) {
        console.error('Usage: co spawn <task-name> <description>');
        process.exit(1);
    }
    orchestrator.spawnTask(taskName, description);
}
function handleClose(args) {
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
function handleKill(args) {
    const [taskName] = args;
    if (!taskName) {
        console.error('Usage: co kill <task-id|task-name>');
        console.error('Example: co kill 4681ae30  (preferred: use task ID from co list)');
        process.exit(1);
    }
    orchestrator.killTask(taskName);
}
function handleMerge(args) {
    const taskName = args[0];
    if (!taskName) {
        console.error('Usage: co merge <task-id|task-name>');
        console.error('Example: co merge 4681ae30  (preferred: use task ID from co list)');
        process.exit(1);
    }
    orchestrator.manualMerge(taskName);
}
function handleNuke(args) {
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
function handleSend(args) {
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
async function handleTool(args) {
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
  co close <task-id|task-name>       - Mark task complete (keeps worktree)
  co merge <task-id|task-name>       - Manually merge a task
  co kill <task-id|task-name>        - Kill/delete a task
  co send <task-id> <command>        - Send command to task's tmux session
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
  co close 4681ae30        (mark complete, manually implemented)
  co merge 4681ae30        (preferred: use task ID from list)
  co merge fix-auth        (also works with task name)
  co send 4681ae30 "npm test"  (send command to task's terminal)
  co kill 4681ae30
  co nuke --confirm

Note: Use 'co list' to see task IDs. Prefer IDs over names to avoid ambiguity.
      Merge only merges - it does NOT run tests or builds. Handle that yourself.
      Close marks a task as complete without deleting - useful for manual work.
      Send allows coordinating commands across parallel tasks via tmux.
`);
}
main().catch(console.error);
