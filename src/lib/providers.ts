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
      const tmuxCommand = `cd ${JSON.stringify(task.worktreePath)} && tmux new-session -s ${JSON.stringify(tmuxSessionName)} -n ${JSON.stringify(task.taskName)} "${settings.claudeCommand} ${JSON.stringify(prompt)}"`;

      console.log(`🚀 Launching Claude in tmux session: ${tmuxSessionName}`);
      console.log(`   Control with: tmux attach -t ${tmuxSessionName}`);
      console.log(`   Send commands: tmux send-keys -t ${tmuxSessionName} "command" C-m`);

      const appleScriptCommand = settings.terminalApp === 'iterm' ?
        `tell application "iTerm" to tell (create window with default profile) to tell current session to write text ${JSON.stringify(tmuxCommand)}` :
        `tell application "Terminal" to do script ${JSON.stringify(tmuxCommand)}`;

      try {
        execSync(`osascript -e ${JSON.stringify(appleScriptCommand)}`);
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
 * OpenAI provider - launches a node script that uses OpenAI API
 */
export class OpenAIProvider implements AIProviderInterface {
  launch(task: GlobalTask, settings: GlobalSettings): string | undefined {
    if (!settings.openaiApiKey) {
      console.error('❌ OpenAI API key not configured');
      return undefined;
    }

    const tmuxSessionName = task.branch.replace(/\//g, '-');

    // Create a wrapper script that will run the OpenAI chat interface
    const scriptPath = this.createOpenAIScript(task, settings);

    if (process.platform === 'darwin') {
      // macOS - use tmux for session management
      const tmuxCommand = `cd ${JSON.stringify(task.worktreePath)} && tmux new-session -s ${JSON.stringify(tmuxSessionName)} -n ${JSON.stringify(task.taskName)} "node ${JSON.stringify(scriptPath)}"`;

      console.log(`🚀 Launching OpenAI assistant in tmux session: ${tmuxSessionName}`);
      console.log(`   Model: ${settings.openaiModel || 'gpt-4'}`);
      console.log(`   Control with: tmux attach -t ${tmuxSessionName}`);

      const appleScriptCommand = settings.terminalApp === 'iterm' ?
        `tell application "iTerm" to tell (create window with default profile) to tell current session to write text ${JSON.stringify(tmuxCommand)}` :
        `tell application "Terminal" to do script ${JSON.stringify(tmuxCommand)}`;

      try {
        execSync(`osascript -e ${JSON.stringify(appleScriptCommand)}`);
        console.log(`✅ Terminal opened successfully`);
        return tmuxSessionName;
      } catch (error) {
        console.error(`❌ Failed to open terminal:`, error);
        return undefined;
      }

    } else if (process.platform === 'win32') {
      // Windows
      const bashCommand = `cd /d ${JSON.stringify(task.worktreePath)} && node ${JSON.stringify(scriptPath)}`;
      execSync(`start cmd /k ${JSON.stringify(bashCommand)}`);
      return undefined;

    } else {
      // Linux - also use tmux
      const tmuxCommand = `cd ${task.worktreePath} && tmux new-session -s ${tmuxSessionName} -n ${task.taskName} "node ${scriptPath}"`;

      const terminal = settings.terminalApp === 'alacritty' ? 'alacritty' :
                       settings.terminalApp === 'wezterm' ? 'wezterm' :
                       'gnome-terminal';

      spawn(terminal, ['--', 'bash', '-c', tmuxCommand], { detached: true });
      return tmuxSessionName;
    }
  }

  validate(settings: GlobalSettings): string | undefined {
    if (!settings.openaiApiKey) {
      return 'OpenAI API key not configured. Set openaiApiKey in global-settings.json';
    }
    return undefined;
  }

  /**
   * Create a Node.js script that will interact with OpenAI API
   */
  private createOpenAIScript(task: GlobalTask, settings: GlobalSettings): string {
    const claudeODir = path.join(task.worktreePath, '.claude-o');
    const scriptPath = path.join(claudeODir, `openai-assistant-${task.id.substring(0, 8)}.js`);

    // Read the task instructions
    const taskMdPath = path.join(claudeODir, `*_${task.taskName}-${task.id.substring(0, 8)}.task.md`);
    const contextJsonPath = path.join(claudeODir, `*_${task.taskName}-${task.id.substring(0, 8)}.context.json`);

    const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

// Configuration
const API_KEY = ${JSON.stringify(settings.openaiApiKey)};
const MODEL = ${JSON.stringify(settings.openaiModel || 'gpt-4')};
const BASE_URL = ${JSON.stringify(settings.openaiBaseUrl || 'https://api.openai.com')};
const TASK_ID = ${JSON.stringify(task.id.substring(0, 8))};

// Load task context
const claudeODir = path.join(process.cwd(), '.claude-o');
const taskFiles = fs.readdirSync(claudeODir);
const taskMdFile = taskFiles.find(f => f.includes('${task.taskName}') && f.endsWith('.task.md'));
const contextJsonFile = taskFiles.find(f => f.includes('${task.taskName}') && f.endsWith('.context.json'));

let systemPrompt = \`You are an AI coding assistant working on a specific task.

Project: ${task.projectName}
Task: ${task.taskName}
Branch: ${task.branch}
Worktree: ${task.worktreePath}

Your goal is to complete the task described below. You can:
- Read and write files in the project
- Run shell commands
- Ask clarifying questions
- Create the .task_complete file when done

When complete, create: .claude-o/*_${task.taskName}-\${TASK_ID}.task_complete
\`;

if (taskMdFile) {
  const taskMd = fs.readFileSync(path.join(claudeODir, taskMdFile), 'utf-8');
  systemPrompt += \`\\n\\nTask Instructions:\\n\${taskMd}\`;
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           OpenAI Coding Assistant (${settings.openaiModel || 'gpt-4'})            ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Task: ${task.taskName}');
console.log('Worktree: ${task.worktreePath}');
console.log('');
console.log('Type your requests or commands. Type "exit" to quit.');
console.log('');

// Conversation history
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: 'Please start working on this task. Read the task description and begin.' }
];

// Function to call OpenAI API
async function callOpenAI(userMessage) {
  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const data = JSON.stringify({
    model: MODEL,
    messages: messages,
    temperature: 0.7,
    max_tokens: 4000
  });

  return new Promise((resolve, reject) => {
    const url = new URL('/v1/chat/completions', BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${API_KEY}\`,
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(body);
            resolve(response);
          } catch (e) {
            reject(new Error('Failed to parse response: ' + e.message));
          }
        } else {
          reject(new Error(\`API error \${res.statusCode}: \${body}\`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Main interaction loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\\n> '
});

// Start with initial message
(async () => {
  try {
    console.log('🤖 Assistant: Starting task analysis...\\n');
    const response = await callOpenAI(null);
    const assistantMessage = response.choices[0].message.content;
    messages.push({ role: 'assistant', content: assistantMessage });
    console.log(assistantMessage);
    console.log('');
    rl.prompt();
  } catch (error) {
    console.error('❌ Error:', error.message);
    rl.prompt();
  }
})();

rl.on('line', async (line) => {
  const input = line.trim();

  if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
    console.log('\\nGoodbye!');
    rl.close();
    process.exit(0);
  }

  if (!input) {
    rl.prompt();
    return;
  }

  try {
    console.log('\\n🤖 Assistant: Thinking...\\n');
    const response = await callOpenAI(input);
    const assistantMessage = response.choices[0].message.content;
    messages.push({ role: 'assistant', content: assistantMessage });
    console.log(assistantMessage);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('401')) {
      console.error('\\nAPI key is invalid. Please check your openaiApiKey in global-settings.json');
    } else if (error.message.includes('429')) {
      console.error('\\nRate limit exceeded. Please wait a moment and try again.');
    }
  }

  console.log('');
  rl.prompt();
});

rl.on('close', () => {
  console.log('\\nSession ended.');
  process.exit(0);
});
`;

    fs.writeFileSync(scriptPath, script);
    fs.chmodSync(scriptPath, '755');

    return scriptPath;
  }
}

/**
 * Factory to get the appropriate provider
 */
export function getProvider(settings: GlobalSettings): AIProviderInterface {
  switch (settings.provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'claude':
    default:
      return new ClaudeProvider();
  }
}
