import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { GlobalTask, Project, GlobalSettings } from './types';

export class GlobalClaudeOrchestrator {
  private db!: Database.Database;
  private configDir: string;
  private dataDir: string;
  private settings!: GlobalSettings;
  
  constructor() {
    this.configDir = path.join(os.homedir(), '.ohclaude');
    this.dataDir = path.join(this.configDir, 'data');
    
    this.ensureSetup();
    this.loadSettings();
    this.initDatabase();
  }
  
  private ensureSetup() {
    const dirs = [
      this.configDir,
      path.join(this.configDir, 'bin'),
      path.join(this.configDir, 'lib'),
      path.join(this.configDir, 'config'),
      this.dataDir,
      path.join(this.configDir, 'logs')
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Create default settings if not exists
    const settingsPath = path.join(this.configDir, 'config', 'global-settings.json');
    if (!fs.existsSync(settingsPath)) {
      const defaultSettings: GlobalSettings = {
        defaultBaseBranch: 'develop',
        worktreesBaseDir: path.join(this.configDir, 'worktrees'),
        autoMerge: true,
        runTests: true,
        testCommands: ['npm test', 'npm run lint', 'npm run build'],
        terminalApp: 'default',
        claudeCommand: 'claude'
      };
      fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    }
  }
  
  private loadSettings() {
    const settingsPath = path.join(this.configDir, 'config', 'global-settings.json');
    this.settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    
    // Ensure worktrees directory exists
    if (!fs.existsSync(this.settings.worktreesBaseDir)) {
      fs.mkdirSync(this.settings.worktreesBaseDir, { recursive: true });
    }
  }
  
  private initDatabase() {
    const dbPath = path.join(this.dataDir, 'tasks.db');
    this.db = new Database(dbPath);
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        task_name TEXT NOT NULL,
        description TEXT,
        worktree_path TEXT,
        branch TEXT,
        base_branch TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        merged_at DATETIME,
        metadata TEXT
      );
      
      CREATE TABLE IF NOT EXISTS projects (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_used DATETIME,
        default_branch TEXT,
        task_count INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_project_path ON tasks(project_path);
      CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
    `);
  }
  
  detectProject(): Project {
    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      const projectName = path.basename(gitRoot);

      // Register or update project
      this.registerProject(gitRoot, projectName);

      return {
        path: gitRoot,
        name: projectName,
        lastUsed: new Date().toISOString(),
        defaultBranch: this.settings.defaultBaseBranch,
        taskCount: 0
      };
    } catch (error) {
      throw new Error('Not in a git repository');
    }
  }
  
  private registerProject(projectPath: string, projectName: string) {
    const existing = this.db.prepare(
      'SELECT * FROM projects WHERE path = ?'
    ).get(projectPath);
    
    if (!existing) {
      this.db.prepare(`
        INSERT INTO projects (path, name, last_used, default_branch)
        VALUES (?, ?, ?, ?)
      `).run(projectPath, projectName, new Date().toISOString(), this.settings.defaultBaseBranch);
    } else {
      this.db.prepare(`
        UPDATE projects SET last_used = ? WHERE path = ?
      `).run(new Date().toISOString(), projectPath);
    }
  }
  
  spawnTask(
    taskName: string, 
    description: string, 
    options: { baseBranch?: string; project?: string } = {}
  ): GlobalTask {
    const project = options.project ? 
      this.getProject(options.project) : 
      this.detectProject();
    
    const timestamp = Date.now();
    const taskId = randomUUID();
    const worktreePath = path.join(
      this.settings.worktreesBaseDir,
      project.name,
      `${taskName}-${timestamp}`
    );
    const branchName = `fix/${taskName}-${timestamp}`;
    const baseBranch = options.baseBranch || this.settings.defaultBaseBranch;
    
    console.log(`\n🚀 Spawning task: ${taskName}`);
    console.log(`📁 Project: ${project.name}`);
    console.log(`🌳 Base branch: ${baseBranch}`);
    console.log(`🔧 Worktree: ${worktreePath}\n`);
    
    // Create worktree
    const originalCwd = process.cwd();
    process.chdir(project.path);
    
    try {
      execSync(`git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`, {
        stdio: 'inherit'
      });
    } catch (error) {
      process.chdir(originalCwd);
      throw error;
    }
    
    process.chdir(originalCwd);
    
    // Create task record
    const task: GlobalTask = {
      id: taskId,
      projectPath: project.path,
      projectName: project.name,
      taskName,
      description,
      worktreePath,
      branch: branchName,
      baseBranch,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    
    // Save to database
    this.db.prepare(`
      INSERT INTO tasks (
        id, project_path, project_name, task_name, 
        description, worktree_path, branch, base_branch, 
        status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.projectPath, task.projectName, task.taskName,
      task.description, task.worktreePath, task.branch, task.baseBranch,
      task.status, task.createdAt
    );
    
    // Update project task count
    this.db.prepare(`
      UPDATE projects 
      SET task_count = task_count + 1 
      WHERE path = ?
    `).run(project.path);
    
    // Create context files
    this.createTaskContext(task);
    
    // Launch Claude
    this.launchClaude(task);
    
    // Log the task
    this.logTask('spawn', task);
    
    return task;
  }
  
  private createTaskContext(task: GlobalTask) {
    const contextData = {
      task,
      orchestrator: {
        version: '1.0.0',
        configDir: this.configDir,
        settings: this.settings
      },
      instructions: `
# Task: ${task.taskName}

## Description
${task.description}

## Project
- Name: ${task.projectName}
- Path: ${task.projectPath}
- Branch: ${task.branch}
- Base: ${task.baseBranch}

## Instructions
1. Work ONLY on this specific task
2. Do not refactor unrelated code
3. Stay in this worktree directory
4. Create .task_complete when done

## Testing
Before marking complete:
${this.settings.testCommands.map(cmd => `- Run: ${cmd}`).join('\n')}

## Completion
When done, create .task_complete with a summary of changes.
`
    };
    
    // Write context files
    fs.writeFileSync(
      path.join(task.worktreePath, '.claude_context.json'),
      JSON.stringify(contextData, null, 2)
    );
    
    fs.writeFileSync(
      path.join(task.worktreePath, 'TASK.md'),
      contextData.instructions
    );
  }
  
  private launchClaude(task: GlobalTask) {
    const prompt = `Read TASK.md for your focused task: ${task.taskName}`;

    if (process.platform === 'darwin') {
      // macOS - use proper escaping via JSON.stringify for bash command
      const bashCommand = `cd ${JSON.stringify(task.worktreePath)} && ${this.settings.claudeCommand} ${JSON.stringify(prompt)}`;

      const appleScriptCommand = this.settings.terminalApp === 'iterm' ?
        `tell application "iTerm" to tell current window to tell current session to write text ${JSON.stringify(bashCommand)}` :
        `tell application "Terminal" to do script ${JSON.stringify(bashCommand)}`;

      console.log(`🚀 Launching Claude in ${this.settings.terminalApp === 'iterm' ? 'iTerm' : 'Terminal'}...`);

      try {
        execSync(`osascript -e ${JSON.stringify(appleScriptCommand)}`);
        console.log(`✅ Terminal opened successfully`);
      } catch (error) {
        console.error(`❌ Failed to open terminal:`, error);
        throw error;
      }

    } else if (process.platform === 'win32') {
      // Windows
      const bashCommand = `cd /d ${JSON.stringify(task.worktreePath)} && ${this.settings.claudeCommand} ${JSON.stringify(prompt)}`;
      execSync(`start cmd /k ${JSON.stringify(bashCommand)}`);

    } else {
      // Linux
      const terminal = this.settings.terminalApp === 'alacritty' ? 'alacritty' :
                       this.settings.terminalApp === 'wezterm' ? 'wezterm' :
                       'gnome-terminal';

      const bashCommand = `cd ${JSON.stringify(task.worktreePath)} && ${this.settings.claudeCommand} ${JSON.stringify(prompt)}; exec bash`;

      spawn(terminal, ['--', 'bash', '-c', bashCommand], { detached: true });
    }
  }
  
  checkProjectTasks(projectPath?: string): { checked: number; completed: number; merged: number } {
    const project = projectPath ? 
      this.getProject(projectPath) : 
      this.detectProject();
    
    const activeTasks = this.db.prepare(`
      SELECT
        id,
        project_path as projectPath,
        project_name as projectName,
        task_name as taskName,
        description,
        worktree_path as worktreePath,
        branch,
        base_branch as baseBranch,
        status,
        created_at as createdAt,
        completed_at as completedAt,
        merged_at as mergedAt,
        metadata
      FROM tasks
      WHERE project_path = ? AND status = 'active'
    `).all(project.path) as GlobalTask[];
    
    let completed = 0;
    let merged = 0;
    
    console.log(`\n🔍 Checking ${activeTasks.length} active tasks for ${project.name}...\n`);
    
    activeTasks.forEach(task => {
      const completeFlagPath = path.join(task.worktreePath, '.task_complete');
      
      if (fs.existsSync(completeFlagPath)) {
        console.log(`✅ Task ready: ${task.taskName}`);
        completed++;

        if (this.settings.autoMerge) {
          if (this.mergeTask(task)) {
            merged++;
          }
        } else {
          console.log(`   ⚠️  autoMerge is disabled. Run 'co merge ${task.taskName}' to merge manually.`);
        }
      }
    });
    
    return { checked: activeTasks.length, completed, merged };
  }
  
  private mergeTask(task: GlobalTask): boolean {
    const originalCwd = process.cwd();
    
    try {
      // Run tests if configured
      if (this.settings.runTests && fs.existsSync(path.join(task.worktreePath, 'package.json'))) {
        console.log('🧪 Running tests...');
        process.chdir(task.worktreePath);
        
        for (const cmd of this.settings.testCommands) {
          try {
            execSync(cmd, { stdio: 'inherit' });
            console.log(`  ✅ ${cmd}`);
          } catch (error) {
            console.log(`  ⚠️ ${cmd} failed or not found`);
          }
        }
      }
      
      // Commit any uncommitted changes
      process.chdir(task.worktreePath);
      try {
        execSync('git add -A');
        execSync(`git commit -m "fix: ${task.taskName}\n\nCompleted by Claude orchestrator"`);
      } catch {
        // No changes to commit
      }
      
      // Merge back to base branch
      process.chdir(task.projectPath);
      const currentBranch = execSync('git branch --show-current', { 
        encoding: 'utf-8' 
      }).trim();
      
      execSync(`git checkout ${task.baseBranch}`);
      execSync(`git merge --no-ff ${task.branch} -m "Merge: ${task.taskName} (automated)"`);
      
      console.log(`✅ Merged ${task.taskName} into ${task.baseBranch}`);
      
      // Clean up worktree
      execSync(`git worktree remove "${task.worktreePath}"`);
      
      // Update database
      this.db.prepare(`
        UPDATE tasks 
        SET status = 'merged', completed_at = ?, merged_at = ? 
        WHERE id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), task.id);
      
      // Return to original branch
      if (currentBranch) {
        execSync(`git checkout ${currentBranch}`);
      }
      
      process.chdir(originalCwd);
      this.logTask('merge', task);
      return true;
      
    } catch (error: any) {
      console.error(`❌ Merge failed: ${error.message}`);
      console.log(`   Task remains active. Fix issues and run 'co check' again.`);
      process.chdir(originalCwd);

      return false;
    }
  }

  manualMerge(taskNameOrId: string, projectPath?: string): void {
    const project = projectPath ?
      this.getProject(projectPath) :
      this.detectProject();

    // Find the task - allow both active and completed tasks
    // Support both task name and task ID (or partial ID)
    const task = this.db.prepare(`
      SELECT
        id,
        project_path as projectPath,
        project_name as projectName,
        task_name as taskName,
        description,
        worktree_path as worktreePath,
        branch,
        base_branch as baseBranch,
        status,
        created_at as createdAt,
        completed_at as completedAt,
        merged_at as mergedAt,
        metadata
      FROM tasks
      WHERE (task_name = ? OR id LIKE ?)
        AND project_path = ?
        AND status IN ('active', 'completed')
    `).get(taskNameOrId, `${taskNameOrId}%`, project.path) as GlobalTask | undefined;

    if (!task) {
      console.error(`❌ Task not found: ${taskNameOrId}`);
      console.log(`   Only active or completed tasks can be merged.`);
      return;
    }

    console.log(`\n🔀 Merging task: ${task.taskName}\n`);

    if (this.mergeTask(task)) {
      console.log(`\n✅ Successfully merged ${task.taskName}`);
    } else {
      console.log(`\n❌ Merge failed. Please resolve conflicts manually.`);
    }
  }

  killTask(taskNameOrId: string, projectPath?: string): void {
    const project = projectPath ?
      this.getProject(projectPath) :
      this.detectProject();

    // Find the task - support both task name and task ID (or partial ID)
    const task = this.db.prepare(`
      SELECT
        id,
        project_path as projectPath,
        project_name as projectName,
        task_name as taskName,
        description,
        worktree_path as worktreePath,
        branch,
        base_branch as baseBranch,
        status,
        created_at as createdAt,
        completed_at as completedAt,
        merged_at as mergedAt,
        metadata
      FROM tasks
      WHERE (task_name = ? OR id LIKE ?)
        AND project_path = ?
        AND status = 'active'
    `).get(taskNameOrId, `${taskNameOrId}%`, project.path) as GlobalTask | undefined;

    if (!task) {
      console.error(`❌ Task not found: ${taskNameOrId}`);
      return;
    }

    const originalCwd = process.cwd();

    try {
      console.log(`🗑️  Killing task: ${task.taskName}`);
      console.log(`   Worktree: ${task.worktreePath}`);
      console.log(`   Branch: ${task.branch}`);

      // Remove worktree if it exists
      if (fs.existsSync(task.worktreePath)) {
        console.log(`   Removing worktree...`);
        process.chdir(task.projectPath);

        try {
          execSync(`git worktree remove "${task.worktreePath}" --force`, { stdio: 'pipe' });
          console.log(`   ✅ Worktree removed`);
        } catch (error: any) {
          console.log(`   ⚠️  Could not remove worktree automatically: ${error.message}`);
          console.log(`   Attempting manual cleanup...`);

          // If git worktree remove fails, manually delete the directory
          try {
            execSync(`rm -rf "${task.worktreePath}"`, { stdio: 'pipe' });
            // Clean up git worktree metadata
            execSync(`git worktree prune`, { stdio: 'pipe' });
            console.log(`   ✅ Manual cleanup successful`);
          } catch (cleanupError: any) {
            console.error(`   ❌ Manual cleanup failed: ${cleanupError.message}`);
          }
        }
      }

      // Delete the branch if it exists
      try {
        process.chdir(task.projectPath);
        execSync(`git branch -D ${task.branch}`, { stdio: 'pipe' });
        console.log(`   ✅ Branch deleted`);
      } catch (error) {
        console.log(`   ⚠️  Branch may not exist or already deleted`);
      }

      // Delete from database
      this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(task.id);

      // Update project task count
      this.db.prepare(`
        UPDATE projects
        SET task_count = task_count - 1
        WHERE path = ?
      `).run(project.path);

      console.log(`✅ Task killed: ${task.taskName}`);

      process.chdir(originalCwd);

    } catch (error: any) {
      console.error(`❌ Failed to kill task: ${error.message}`);
      process.chdir(originalCwd);
      throw error;
    }
  }

  nukeAllTasks(projectPath?: string): void {
    let project: Project;

    if (projectPath) {
      project = this.getProject(projectPath);
    } else {
      try {
        project = this.detectProject();
      } catch (error) {
        // Not in a git repo, show all projects and exit
        console.error('❌ Not in a git repository.');
        console.log('\nAvailable projects:');
        const projects = this.db.prepare(`SELECT * FROM projects ORDER BY last_used DESC`).all() as Project[];
        if (projects.length === 0) {
          console.log('   No projects found.');
          return;
        }
        projects.forEach(p => {
          console.log(`   • ${p.name} (${p.path})`);
        });
        console.log('\nUsage: co nuke --confirm <project-path>');
        console.log('Example: co nuke --confirm /Users/kourtis/Sources/darkmortgage-backend');
        return;
      }
    }

    console.log(`\n💣 NUCLEAR OPTION: Erasing ALL tasks for ${project.name}\n`);
    console.log(`⚠️  This will:`);
    console.log(`   - Remove all worktrees`);
    console.log(`   - Delete all branches`);
    console.log(`   - Erase all task records from database`);
    console.log(`\n`);

    // Get all tasks for this project
    const allTasks = this.db.prepare(`
      SELECT
        id,
        project_path as projectPath,
        project_name as projectName,
        task_name as taskName,
        description,
        worktree_path as worktreePath,
        branch,
        base_branch as baseBranch,
        status,
        created_at as createdAt,
        completed_at as completedAt,
        merged_at as mergedAt,
        metadata
      FROM tasks
      WHERE project_path = ?
    `).all(project.path) as GlobalTask[];

    if (allTasks.length === 0) {
      console.log(`✅ No tasks to erase for ${project.name}`);
      return;
    }

    console.log(`Found ${allTasks.length} tasks to erase...\n`);

    const originalCwd = process.cwd();
    let removed = 0;
    let failed = 0;

    allTasks.forEach(task => {
      try {
        console.log(`🗑️  Erasing: ${task.taskName} [${task.id.substring(0, 8)}]`);

        // Remove worktree if it exists
        if (fs.existsSync(task.worktreePath)) {
          process.chdir(task.projectPath);
          try {
            execSync(`git worktree remove "${task.worktreePath}" --force`, { stdio: 'pipe' });
          } catch {
            // Try manual cleanup
            execSync(`rm -rf "${task.worktreePath}"`, { stdio: 'pipe' });
            execSync(`git worktree prune`, { stdio: 'pipe' });
          }
        }

        // Delete branch if it exists
        try {
          process.chdir(task.projectPath);
          execSync(`git branch -D ${task.branch}`, { stdio: 'pipe' });
        } catch {
          // Branch may not exist
        }

        // Delete from database
        this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(task.id);

        removed++;
      } catch (error: any) {
        console.error(`   ❌ Failed: ${error.message}`);
        failed++;
      }
    });

    // Reset project task count
    this.db.prepare(`
      UPDATE projects
      SET task_count = 0
      WHERE path = ?
    `).run(project.path);

    process.chdir(originalCwd);

    console.log(`\n💥 Nuke complete!`);
    console.log(`   Removed: ${removed}`);
    if (failed > 0) {
      console.log(`   Failed: ${failed}`);
    }
    console.log(``);
  }

  getCurrentProjectTasks(): GlobalTask[] {
    const project = this.detectProject();
    return this.db.prepare(`
      SELECT
        id,
        project_path as projectPath,
        project_name as projectName,
        task_name as taskName,
        description,
        worktree_path as worktreePath,
        branch,
        base_branch as baseBranch,
        status,
        created_at as createdAt,
        completed_at as completedAt,
        merged_at as mergedAt,
        metadata
      FROM tasks
      WHERE project_path = ?
      ORDER BY created_at DESC
    `).all(project.path) as GlobalTask[];
  }
  
  listAllTasks(): void {
    const projects = this.db.prepare(`
      SELECT * FROM projects 
      ORDER BY last_used DESC
    `).all() as Project[];
    
    console.log('\n📊 GLOBAL TASK OVERVIEW\n');
    console.log('=' .repeat(60));
    
    projects.forEach(project => {
      const activeTasks = this.db.prepare(`
        SELECT
          id,
          project_path as projectPath,
          project_name as projectName,
          task_name as taskName,
          description,
          worktree_path as worktreePath,
          branch,
          base_branch as baseBranch,
          status,
          created_at as createdAt,
          completed_at as completedAt,
          merged_at as mergedAt,
          metadata
        FROM tasks
        WHERE project_path = ? AND status = 'active'
      `).all(project.path) as GlobalTask[];

      const completedTasks = this.db.prepare(`
        SELECT
          id,
          project_path as projectPath,
          project_name as projectName,
          task_name as taskName,
          description,
          worktree_path as worktreePath,
          branch,
          base_branch as baseBranch,
          status,
          created_at as createdAt,
          completed_at as completedAt,
          merged_at as mergedAt,
          metadata
        FROM tasks
        WHERE project_path = ? AND status IN ('completed', 'merged')
        ORDER BY completed_at DESC LIMIT 3
      `).all(project.path) as GlobalTask[];
      
      if (activeTasks.length > 0 || completedTasks.length > 0) {
        console.log(`\n📁 ${project.name}`);
        console.log(`   ${project.path}`);
        console.log(`   Last used: ${new Date(project.lastUsed).toLocaleDateString()}`);
        
        if (activeTasks.length > 0) {
          console.log('\n   🔧 Active Tasks:');
          activeTasks.forEach(task => {
            const age = this.getTaskAge(task.createdAt);
            const shortId = task.id.substring(0, 8);
            console.log(`      • ${task.taskName} [${shortId}] (${age})`);
          });
        }

        if (completedTasks.length > 0) {
          console.log('\n   ✅ Recently Completed:');
          completedTasks.forEach(task => {
            const status = task.status === 'merged' ? '🔀' : '✓';
            const shortId = task.id.substring(0, 8);
            console.log(`      ${status} ${task.taskName} [${shortId}]`);
          });
        }
      }
    });
    
    console.log('\n' + '=' .repeat(60));
    
    // Summary stats
    const stats = this.db.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'merged' THEN 1 END) as merged,
        COUNT(*) as total
      FROM tasks
    `).get() as any;
    
    console.log('\n📈 Summary:');
    console.log(`   Total tasks: ${stats.total}`);
    console.log(`   Active: ${stats.active}`);
    console.log(`   Completed: ${stats.completed}`);
    console.log(`   Merged: ${stats.merged}\n`);
  }
  
  private getTaskAge(createdAt: string): string {
    const created = new Date(createdAt);
    const now = new Date();
    const hours = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60));
    
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  
  private getProject(identifier: string): Project {
    // Try as path first
    if (fs.existsSync(identifier)) {
      return {
        path: identifier,
        name: path.basename(identifier),
        lastUsed: new Date().toISOString(),
        defaultBranch: this.settings.defaultBaseBranch,
        taskCount: 0
      };
    }
    
    // Try as name in database
    const project = this.db.prepare(`
      SELECT * FROM projects 
      WHERE name = ? OR path = ?
    `).get(identifier, identifier) as Project | undefined;
    
    if (project) return project;
    
    throw new Error(`Project not found: ${identifier}`);
  }
  
  private logTask(action: string, task: GlobalTask) {
    const logPath = path.join(this.configDir, 'logs', 'orchestrator.log');
    const logEntry = `[${new Date().toISOString()}] ${action.toUpperCase()}: ${task.taskName} (${task.id}) in ${task.projectName}\n`;
    fs.appendFileSync(logPath, logEntry);
  }
}