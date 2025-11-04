export interface GlobalTask {
  id: string;
  projectPath: string;
  projectName: string;
  taskName: string;
  description: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  status: 'active' | 'completed' | 'failed' | 'merged';
  createdAt: string;
  completedAt?: string;
  mergedAt?: string;
  metadata?: Record<string, any>;
}

export interface Project {
  path: string;
  name: string;
  lastUsed: string;
  defaultBranch: string;
  taskCount: number;
}

export interface ClaudeToolCall {
  name: string;
  arguments: {
    name: string;
    description: string;
    baseBranch?: string;
    project?: string;
  };
}

export type AIProvider = 'claude' | 'openai';

export interface GlobalSettings {
  defaultBaseBranch: string;
  worktreesBaseDir: string;
  autoMerge: boolean;
  runTests: boolean;
  testCommands: string[];
  terminalApp: 'default' | 'iterm' | 'wezterm' | 'alacritty';
  claudeCommand: string;
  provider: AIProvider;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
}