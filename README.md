# AI Task Orchestrator (formerly Claude Orchestrator)

A global task orchestration system that uses git worktrees to run multiple parallel AI coding assistant sessions on independent tasks. Supports both Claude Code and OpenAI Codex CLI.

## Features

- **Multiple AI Providers**: Choose between Claude Code or OpenAI Codex CLI
- **Parallel Task Execution**: Spawn multiple AI assistant instances working on different tasks simultaneously
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
5. Configure the MCP server for Claude Code

After installation, restart your shell or run:
```bash
source ~/.zshrc  # or source ~/.bashrc

# Clean up the temporary clone
rm -rf /tmp/claude-o
```

## Usage

### CLI Commands

```bash
# Spawn a new task (creates detached tmux session)
co spawn fix-auth "Fix authentication token refresh bug"
co s fix-auth "Fix authentication token refresh bug"  # shortcut

# List tasks (tabular format)
co list              # Current repo only (default)
co list all          # All tasks from all repos
co list my-project   # Tasks from specific project
co l                 # Shortcut for current repo

# Check and merge completed tasks
co check
co c  # shortcut

# Clean completed/merged task worktrees and prune git
co clean             # Current repo only
co clean all         # All repos
co clean my-project  # Specific project

# Mark a task as complete without deleting worktree
co close fix-auth    # Keeps worktree & branch for later merge

# Manually merge a specific task
co merge fix-auth
co m fix-auth  # shortcut

# Send command to a task's tmux session (sends text + Enter)
co send fix-auth "npm test"
co x fix-auth "Also add error handling"  # shortcut

# Kill/delete a task permanently
co kill fix-auth     # Deletes worktree, branch, and records
co k fix-auth        # shortcut

# Erase ALL tasks for current project (dangerous!)
co nuke --confirm
```

#### Send Command (Task Coordination)

The `send` command allows you to send text input to a task's tmux session:

```bash
co send <task-id> "<command>"
co x <task-id> "<command>"      # shortcut
```

**How it works:**
1. Sends the command text to the task's tmux session
2. Automatically sends Enter key to execute it

**Use cases:**
- Send new instructions to a running AI task
- Run tests in a task's terminal
- Coordinate multiple tasks
- Provide feedback or corrections

**Examples:**
```bash
# Send additional instructions to a task
co send 4681ae30 "Also add error handling for edge cases"

# Run tests in a task's worktree
co send a1b2c3d4 "npm test"

# Send follow-up requirements
co x 6afee43a "Make sure to update the documentation"
```

#### Command Comparison

| Command | Stops Task | Keeps Worktree | Keeps Branch | Can Merge Later | Use Case |
|---------|------------|----------------|--------------|-----------------|----------|
| `close` | Yes | Yes | Yes | Yes | Task done manually, merge later |
| `kill` | Yes | No | No | No | Abandon task completely |
| `merge` | N/A | N/A | Merged | N/A | Merge completed task to base |
| `send` | No | N/A | N/A | N/A | Send commands/instructions to running task |

#### List Output Format

The `co list` command displays tasks in a clean tabular format:

```
Tasks for my-project
================================================================================

┌──────────┬─────────────────────────┬──────────┬────────────┬─────────────┐
│ ID       │ Task                    │ Status   │ Age        │ Description │
├──────────┼─────────────────────────┼──────────┼────────────┼─────────────┤
│ 4681ae30 │ fix-auth                │ active   │ 2h ago     │ Fix auth…   │
│ a1b2c3d4 │ update-ui               │ done     │ 1d ago     │ Update UI   │
└──────────┴─────────────────────────┴──────────┴────────────┴─────────────┘

Summary: 1 active, 1 completed
```

**Tmux Workflow:**
- Tasks run in **detached** tmux sessions (background)
- Attach when you want to work: `tmux attach -t <session-name>`
- Detach to return to main terminal: `Ctrl+b`, then `d`
- Send commands from main terminal: `co send <task-id> "command"`
- List all sessions: `tmux list-sessions`
- Sessions persist even after closing terminal windows

### Claude Code Integration (MCP)

Once installed, Claude Code will have access to these tools for task management and orchestration:

#### Task Management Tools

**`spawn_task`**
Create an isolated git worktree and spawn a separate AI assistant instance to work on a specific task in parallel.

```
Can you spawn a task to add unit tests for the authentication module?
```

**`list_tasks`**
List all active and recently completed tasks across all projects.

```
Show me all my current tasks
```

**`check_tasks`**
Check all active tasks for completion and automatically merge completed ones.

```
Check if any of my tasks are completed
```

**`close_task`**
Mark a task as completed without deleting the worktree or branch. Useful when you've manually implemented a task.

```
Close the fix-auth task
```

**`merge_task`**
Manually merge a specific task back to its base branch.

```
Merge the fix-auth task
```

**`kill_task`**
Kill and remove a specific task, terminating its tmux session and deleting worktree/branch.

```
Kill the test-feature task
```

#### Orchestration & Monitoring Tools

**`send_command`**
Send a command or message to a task's tmux session. Use this to communicate with spawned tasks, provide guidance, or intervene when needed.

```
Send a command to fix-auth: "Please focus on the token refresh logic only"
```

**`read_session_output`**
Read the terminal output from a task's tmux session. Monitor what the AI is doing, check for errors, or verify progress.

```
Read the output from fix-auth task
```

**`list_sessions`**
List all active tmux sessions for running tasks, showing which are running or terminated.

```
List all active sessions
```

#### Orchestration Best Practices

When spawning tasks, Claude can:
- **Monitor progress**: Use `read_session_output` to check what the task is doing
- **Intervene if needed**: Use `send_command` to provide guidance or corrections
- **Detect deviations**: Watch for tasks going off-track and redirect them
- **Coordinate tasks**: Send commands to multiple tasks for complex workflows

Example orchestration workflow:
```
Me: Please refactor the auth module and add tests

Claude:
1. Spawns "refactor-auth" task
2. Spawns "add-auth-tests" task
3. Monitors both sessions periodically with read_session_output
4. Notices refactor-auth is modifying unrelated files
5. Sends command: "Please focus only on auth module refactoring"
6. Waits for both to complete
7. Checks and merges both tasks
```

## Configuration

### Settings

Edit `~/.claude-o/config/global-settings.json`:

```json
{
  "defaultBaseBranch": "master",
  "worktreesBaseDir": "~/.claude-o/worktrees",
  "autoMerge": true,
  "runTests": true,
  "testCommands": ["npm test", "npm run lint", "npm run build"],
  "terminalApp": "default",
  "claudeCommand": "claude",
  "provider": "claude",
  "codexCommand": "codex"
}
```

#### AI Provider Configuration

The `provider` setting determines which AI assistant to use for tasks. Available options:

**Claude** (`"provider": "claude"`)
- Uses Claude Code CLI
- Requires Claude Code to be installed (`claude` command available)
- Best integration with MCP tools
- Configuration:
  - `claudeCommand`: Command to launch Claude (default: `"claude"`)

**OpenAI Codex** (`"provider": "codex"`)
- Uses OpenAI Codex CLI - an open-source coding agent that runs in your terminal
- Built in Rust for speed and efficiency
- Similar interface to Claude Code
- Configuration:
  - `codexCommand`: Command to launch Codex (default: `"codex"`)

##### Setting up OpenAI Codex

1. Install Codex CLI:
   ```bash
   # Using npm
   npm i -g @openai/codex

   # Or using Homebrew (macOS)
   brew install --cask codex
   ```

2. Authenticate Codex (first time only):
   ```bash
   codex
   # You'll be prompted to sign in with your ChatGPT account
   # Codex works with ChatGPT Plus, Pro, Business, Edu, or Enterprise plans
   # You can also use an API key for authentication
   ```

3. Edit `~/.claude-o/config/global-settings.json`:
   ```json
   {
     "provider": "codex",
     "codexCommand": "codex"
   }
   ```

4. Spawn a task as usual: `co spawn fix-bug "Fix authentication bug"`
5. Codex will launch in your terminal with full context of the task

**Platform Support:**
- **macOS**: Fully supported
- **Linux**: Fully supported
- **Windows**: Experimental (use WSL recommended)

**Note**: Codex requires a ChatGPT subscription or OpenAI API key. Learn more at https://github.com/openai/codex

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
   - Generates task files in `.claude-o/` directory with versioned naming
   - Launches Claude in a detached tmux session (runs in background)

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
# 🚀 Launched Claude in tmux session: fix-add-dark-mode-1234567
#    Attach with: tmux attach -t fix-add-dark-mode-1234567

# Attach to work on it
tmux attach -t fix-add-dark-mode-1234567

# Claude works on the feature...
# When done, detach: Ctrl+b, then d

# Check and merge
co check  # Auto-merges the completed task
```

### Example 2: Fix Multiple Bugs in Parallel
```bash
# Spawn three tasks (all run in background)
co spawn fix-auth "Fix token refresh bug"
co spawn fix-ui "Fix button alignment on mobile"
co spawn fix-api "Handle API timeout errors"

# All three Claude instances are now working in parallel
# Attach to any one to monitor/interact:
tmux attach -t fix-fix-auth-1234567

# Or send commands from main terminal:
co send <task-id> "npm test"

# Check status
co list  # See all active tasks
co check # Merge any completed tasks
```

### Example 3: Coordinate Multiple Tasks
```bash
# Spawn frontend and backend tasks
co spawn ui-update "Update dashboard UI"
co spawn api-update "Update API endpoints"

# From main terminal, coordinate testing:
co send <ui-task-id> "npm run test:ui"
co send <api-task-id> "npm run test:api"

# Attach to review one:
tmux attach -t fix-ui-update-1234567
# Detach when done: Ctrl+b, then d

# Merge when ready
co merge <ui-task-id>
co merge <api-task-id>
```

### Example 4: Using from Claude Code
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
