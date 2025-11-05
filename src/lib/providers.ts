import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import { GlobalTask, GlobalSettings } from './types';

/**
 * Interface for AI providers that can be used to launch coding assistants
 */
export interface AIProviderInterface {
  /**
   * Launch the AI assistant in a terminal for the given task
   * @param task The task to work on
   * @param settings Global settings
   * @returns The tmux session name if successful, undefined otherwise
   */
  launch(task: GlobalTask, settings: GlobalSettings): string | undefined;

  /**
   * Check if the provider is properly configured
   * @param settings Global settings
   * @returns Error message if misconfigured, undefined if OK
   */
  validate(settings: GlobalSettings): string | undefined;
}

/**
 * Claude provider - launches Claude Code via CLI
 */
export class ClaudeProvider implements AIProviderInterface {
  launch(task: GlobalTask, settings: GlobalSettings): string | undefined {
    const taskMdPath = `.claude-o/*_${task.taskName}-${task.id.substring(0, 8)}.task.md`;
    const prompt = `Read ${taskMdPath} for your focused task: ${task.taskName}`;

    const tmuxSessionName = task.branch.replace(/\//g, '-');

    if (process.platform === 'darwin') {
      // macOS - use tmux for session management
      // Disable MCP servers for spawned tasks to avoid tool name conflicts
      // Use single quotes for tmux command to avoid quote escaping issues
      const tmuxCommand = `cd ${JSON.stringify(task.worktreePath)} && tmux new-session -s ${JSON.stringify(tmuxSessionName)} -n ${JSON.stringify(task.taskName)} '${settings.claudeCommand} --strict-mcp-config ${JSON.stringify(prompt)}'`;

      console.log(`🚀 Launching Claude in tmux session: ${tmuxSessionName}`);
      console.log(`   Control with: tmux attach -t ${tmuxSessionName}`);
      console.log(`   Send commands: tmux send-keys -t ${tmuxSessionName} "command" C-m`);

      const appleScriptCommand = settings.terminalApp === 'iterm' ?
        `tell application "iTerm" to tell (create window with default profile) to tell current session to write text ${JSON.stringify(tmuxCommand)}` :
        `tell application "Terminal" to do script ${JSON.stringify(tmuxCommand)}`;

      try {
        execSync(`osascript -e ${JSON.stringify(appleScriptCommand)}`, { stdio: 'pipe' });
        console.log(`✅ Terminal opened successfully`);
        return tmuxSessionName;
      } catch (error) {
        console.error(`❌ Failed to open terminal:`, error);
        return undefined;
      }

    } else if (process.platform === 'win32') {
      // Windows
      const bashCommand = `cd /d ${JSON.stringify(task.worktreePath)} && ${settings.claudeCommand} ${JSON.stringify(prompt)}`;
      execSync(`start cmd /k ${JSON.stringify(bashCommand)}`);
      return undefined;

    } else {
      // Linux - also use tmux
      const tmuxCommand = `cd ${task.worktreePath} && tmux new-session -s ${tmuxSessionName} -n ${task.taskName} "${settings.claudeCommand} ${prompt}"`;

      const terminal = settings.terminalApp === 'alacritty' ? 'alacritty' :
                       settings.terminalApp === 'wezterm' ? 'wezterm' :
                       'gnome-terminal';

      spawn(terminal, ['--', 'bash', '-c', tmuxCommand], { detached: true });
      return tmuxSessionName;
    }
  }

  validate(settings: GlobalSettings): string | undefined {
    // Check if Claude command is available
    try {
      execSync(`which ${settings.claudeCommand}`, { stdio: 'pipe' });
      return undefined;
    } catch (error) {
      return `Claude command '${settings.claudeCommand}' not found. Please install Claude Code CLI.`;
    }
  }
}

/**
 * Codex provider - launches OpenAI Codex CLI
 */
export class CodexProvider implements AIProviderInterface {
  launch(task: GlobalTask, settings: GlobalSettings): string | undefined {
    const codexCommand = settings.codexCommand || 'codex';
    const taskMdPath = `.claude-o/*_${task.taskName}-${task.id.substring(0, 8)}.task.md`;
    const prompt = `Read ${taskMdPath} for your focused task: ${task.taskName}`;

    const tmuxSessionName = task.branch.replace(/\//g, '-');

    if (process.platform === 'darwin') {
      // macOS - use tmux for session management
      // Use single quotes for tmux command to avoid quote escaping issues
      const tmuxCommand = `cd ${JSON.stringify(task.worktreePath)} && tmux new-session -s ${JSON.stringify(tmuxSessionName)} -n ${JSON.stringify(task.taskName)} '${codexCommand} ${JSON.stringify(prompt)}'`;

      console.log(`🚀 Launching Codex in tmux session: ${tmuxSessionName}`);
      console.log(`   Control with: tmux attach -t ${tmuxSessionName}`);
      console.log(`   Send commands: tmux send-keys -t ${tmuxSessionName} "command" C-m`);

      const appleScriptCommand = settings.terminalApp === 'iterm' ?
        `tell application "iTerm" to tell (create window with default profile) to tell current session to write text ${JSON.stringify(tmuxCommand)}` :
        `tell application "Terminal" to do script ${JSON.stringify(tmuxCommand)}`;

      try {
        execSync(`osascript -e ${JSON.stringify(appleScriptCommand)}`, { stdio: 'pipe' });
        console.log(`✅ Terminal opened successfully`);
        return tmuxSessionName;
      } catch (error) {
        console.error(`❌ Failed to open terminal:`, error);
        return undefined;
      }

    } else if (process.platform === 'win32') {
      // Windows (WSL recommended)
      const bashCommand = `cd /d ${JSON.stringify(task.worktreePath)} && ${codexCommand} ${JSON.stringify(prompt)}`;
      execSync(`start cmd /k ${JSON.stringify(bashCommand)}`);
      return undefined;

    } else {
      // Linux - also use tmux
      const tmuxCommand = `cd ${task.worktreePath} && tmux new-session -s ${tmuxSessionName} -n ${task.taskName} "${codexCommand} ${prompt}"`;

      const terminal = settings.terminalApp === 'alacritty' ? 'alacritty' :
                       settings.terminalApp === 'wezterm' ? 'wezterm' :
                       'gnome-terminal';

      spawn(terminal, ['--', 'bash', '-c', tmuxCommand], { detached: true });
      return tmuxSessionName;
    }
  }

  validate(settings: GlobalSettings): string | undefined {
    const codexCommand = settings.codexCommand || 'codex';
    // Check if Codex CLI is available
    try {
      execSync(`which ${codexCommand}`, { stdio: 'pipe' });
      return undefined;
    } catch (error) {
      return `Codex CLI '${codexCommand}' not found. Install with: npm i -g @openai/codex or brew install --cask codex`;
    }
  }
}

/**
 * Factory to get the appropriate provider
 */
export function getProvider(settings: GlobalSettings): AIProviderInterface {
  switch (settings.provider) {
    case 'codex':
      return new CodexProvider();
    case 'claude':
    default:
      return new ClaudeProvider();
  }
}
