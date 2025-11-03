# Claude Orchestrator

A global task orchestration system for Claude Code that uses git worktrees to run multiple parallel Claude sessions on independent tasks.

## Features

- **Parallel Task Execution**: Spawn multiple Claude instances working on different tasks simultaneously
- **Git Worktree Integration**: Each task gets its own isolated git worktree
- **Tmux Session Management**: Each task runs in a named tmux session for easy coordination
- **Command Injection**: Send commands to task terminals via `co send` for cross-task coordination
- **MCP Server Integration**: Seamlessly integrates with Claude Code via Model Context Protocol
- **Task Management**: Track, merge, close, and clean up tasks across all your projects
- **Auto-merge**: Automatically merge completed tasks back to base branch

## Prerequisites

- **macOS**: tmux (for terminal session management and command coordination)
  ```bash
  brew install tmux
  ```
- **Linux**: tmux is usually pre-installed or available via package manager
- **Git**: For worktree management
- **Node.js**: For running the CLI and MCP server

## Installation

```bash
# Clone the repository
git clone <repo-url> /tmp/claude-o
cd /tmp/claude-o

# Run the installer (copies everything to ~/.claude-o)
./install.sh
```

This will:
1. Copy all files to `~/.claude-o`
2. Install dependencies with `yarn`
3. Build the TypeScript code
4. Add the `co` command alias to your shell
5. Detect and configure your preferred terminal (macOS: defaults to iTerm if available, otherwise Terminal)
6. Configure the MCP server for Claude Code

After installation, restart your shell or run:
```bash
source ~/.zshrc  # or source ~/.bashrc

# Clean up the temporary clone
rm -rf /tmp/claude-o
```

## Usage

### CLI Commands

```bash
# Spawn a new task (opens in tmux session)
co spawn fix-auth "Fix authentication token refresh bug"

# List all tasks
co list

# Check and merge completed tasks
co check

# Mark a task as complete without deleting worktree
co close fix-auth

# Manually merge a specific task
co merge fix-auth

# Send command to a task's tmux session
co send fix-auth "npm test"

# Kill/delete a task
co kill fix-auth

# Erase ALL tasks for current project (dangerous!)
co nuke --confirm
```

**Tmux Integration:**
- Each spawned task runs in a tmux session named after its branch
- Use `co send <task-id> <command>` to inject commands into task terminals
- Attach to a session: `tmux attach -t fix-<task>-<timestamp>`
- List sessions: `tmux list-sessions`

### Claude Code Integration (MCP)

Once installed, Claude Code will have access to these tools:

#### `spawn_task`
Create an isolated git worktree and spawn a separate Claude CLI instance to work on a specific task in parallel.

```
Can you spawn a task to add unit tests for the authentication module?
```

#### `list_tasks`
List all active and recently completed tasks across all projects.

```
Show me all my current tasks
```

#### `check_tasks`
Check all active tasks for completion and automatically merge completed ones.

```
Check if any of my tasks are completed
```

#### `close_task`
Mark a task as completed without deleting the worktree or branch. Useful when you've manually implemented a task.

```
Close the fix-auth task
```

#### `merge_task`
Manually merge a specific task back to its base branch.

```
Merge the fix-auth task
```

#### `kill_task`
Kill and remove a specific task.

```
Kill the test-feature task
```

## Configuration

### Settings

Edit `~/.claude-o/config/global-settings.json`:

```json
{
  "defaultBaseBranch": "develop",
  "worktreesBaseDir": "~/.claude-o/worktrees",
  "autoMerge": true,
  "runTests": true,
  "testCommands": ["npm test", "npm run lint", "npm run build"],
  "terminalApp": "default",
  "claudeCommand": "claude"
}
```

#### Terminal App Options

The `terminalApp` setting controls which terminal application opens when spawning tasks:

- **macOS**: `"iterm"` (iTerm - default) or `"default"` (Terminal.app)
- **Linux**: `"default"` (gnome-terminal), `"alacritty"`, or `"wezterm"`
- **Windows**: Uses `cmd` by default

The installer will automatically detect and configure your preferred terminal on macOS (defaults to iTerm if available).

### MCP Server

The MCP server is automatically configured using the Claude CLI command:

```bash
claude mcp add --scope user --transport stdio claude-o -- node ~/.claude-o/dist/src/mcp/server.js
```

This adds the server at **user scope**, making it available across all your projects.

#### Configuration Scopes

- **user scope**: Available across all projects (recommended for this tool)
- **project scope**: Only available in specific project (stored in `.mcp.json`)
- **local scope**: Project-specific, private to you

#### Manual Configuration

If you prefer to configure manually, add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "claude-o": {
      "command": "node",
      "args": ["~/.claude-o/dist/src/mcp/server.js"]
    }
  }
}
```

All files are installed to `~/.claude-o` regardless of where you cloned the repository.

## How It Works

1. **Task Spawning**: When you spawn a task, the orchestrator:
   - Creates a new git worktree in `~/.claude-o/worktrees/<project>/<task-timestamp>/`
   - Creates a new branch `fix/<task-name-timestamp>`
   - Generates a `TASK.md` file with task details
   - Opens a new terminal with Claude Code running in that worktree

2. **Task Completion**: When a task is complete:
   - Create a `.task_complete` file in the worktree
   - Run `co check` to merge it back
   - Or let auto-merge handle it automatically

3. **Cleanup**: Completed tasks are:
   - Merged back to the base branch
   - Worktrees are removed
   - Branches are deleted
   - Database records are updated

## Project Structure

```
~/.claude-o/
├── config/
│   └── global-settings.json
├── data/
│   └── orchestrator.db
├── worktrees/
│   ├── project1/
│   │   ├── task1-timestamp/
│   │   └── task2-timestamp/
│   └── project2/
└── logs/
```

## Examples

### Example 1: Add a Feature
```bash
# From your main project directory
co spawn add-dark-mode "Implement dark mode toggle in settings"

# A new terminal opens with Claude in the worktree
# Work on the feature...
# When done, create completion flag:
touch .task_complete

# Back in main terminal
co check  # Auto-merges the completed task
```

### Example 2: Fix Multiple Bugs
```bash
co spawn fix-auth "Fix token refresh bug"
co spawn fix-ui "Fix button alignment on mobile"
co spawn fix-api "Handle API timeout errors"

# Three terminals open, each with Claude working on a different bug
# Work proceeds in parallel

co list  # See all active tasks
co check # Merge any completed tasks
```

### Example 3: Using from Claude Code
```
Me: I need to refactor the authentication module and add comprehensive tests.
    Can you spawn separate tasks for the refactoring and testing?

Claude: I'll spawn two parallel tasks for you.
<uses spawn_task tool twice>

Task "refactor-auth" spawned successfully in worktree.
Task "add-auth-tests" spawned successfully in worktree.

You now have two Claude instances working in parallel on these tasks.
```

## Troubleshooting

### MCP Server Not Working

1. List configured MCP servers:
```bash
claude mcp list
```

2. Check if claude-o is listed:
```bash
claude mcp list | grep claude-o
```

3. Re-add the server if missing:
```bash
claude mcp add --scope user --transport stdio claude-o -- node ~/.claude-o/dist/src/mcp/server.js
```

4. Test the MCP server manually:
```bash
node ~/.claude-o/dist/src/mcp/server.js
```

5. Check Claude Code logs:
```bash
tail -f ~/.claude/debug/*.log
```

### Tasks Not Showing Up

1. Check the database:
```bash
sqlite3 ~/.claude-o/data/orchestrator.db "SELECT * FROM tasks;"
```

2. Verify you're in a git repository:
```bash
git rev-parse --show-toplevel
```

### Clean Slate

Remove everything and start fresh:
```bash
rm -rf ~/.claude-o
./install.sh
```

## License

MIT
