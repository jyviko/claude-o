import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { GlobalTask, Project, GlobalSettings } from './types';
import { getProvider } from './providers';

export class GlobalClaudeOrchestrator {
  private db!: Database.Database;
  private configDir: string;
  private dataDir: string;
  private settings!: GlobalSettings;
  
  constructor() {
    this.configDir = path.join(os.homedir(), '.claude-o');
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
        defaultBaseBranch: 'master',
        worktreesBaseDir: path.join(this.configDir, 'worktrees'),
        autoMerge: true,
        runTests: true,
        testCommands: ['yarn test', 'yarn build'],
        terminalApp: 'iterm',
        claudeCommand: 'claude',
        provider: 'claude',
        codexCommand: 'codex'
      };
      fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    }
  }
  
  private loadSettings() {
    const settingsPath = path.join(this.configDir, 'config', 'global-settings.json');
    this.settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // Ensure provider is set (for backward compatibility)
    if (!this.settings.provider) {
      this.settings.provider = 'claude';
    }

    // Ensure worktrees directory exists
    if (!fs.existsSync(this.settings.worktreesBaseDir)) {
      fs.mkdirSync(this.settings.worktreesBaseDir, { recursive: true });
    }

    // Validate provider configuration
    const provider = getProvider(this.settings);
    const validationError = provider.validate(this.settings);
    if (validationError) {
      console.warn(`⚠️  Warning: ${validationError}`);
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
      let gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      // Check if we're in a worktree - if so, find the main working tree
      try {
        const commonDir = execSync('git rev-parse --git-common-dir', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          cwd: gitRoot
        }).trim();

        // If commonDir is not just ".git", we're in a worktree
        if (commonDir !== '.git' && !path.isAbsolute(commonDir)) {
          // commonDir is relative, resolve it and go up to find main repo
          const absoluteCommonDir = path.resolve(gitRoot, commonDir);
          gitRoot = path.dirname(absoluteCommonDir);
        } else if (path.isAbsolute(commonDir) && commonDir.endsWith('.git')) {
          // Absolute path to .git directory
          gitRoot = path.dirname(commonDir);
        }
      } catch (error) {
        // Not a worktree or error getting commonDir, use gitRoot as-is
      }

      const projectName = path.basename(gitRoot);

      // Detect current branch
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        cwd: gitRoot
      }).trim();

      // Register or update project
      this.registerProject(gitRoot, projectName, currentBranch);

      return {
        path: gitRoot,
        name: projectName,
        lastUsed: new Date().toISOString(),
        defaultBranch: currentBranch || this.settings.defaultBaseBranch,
        taskCount: 0
      };
    } catch (error) {
      throw new Error('Not in a git repository');
    }
  }
  
  private registerProject(projectPath: string, projectName: string, defaultBranch?: string) {
    const existing = this.db.prepare(
      'SELECT * FROM projects WHERE path = ?'
    ).get(projectPath);

    const branch = defaultBranch || this.settings.defaultBaseBranch;

    if (!existing) {
      this.db.prepare(`
        INSERT INTO projects (path, name, last_used, default_branch)
        VALUES (?, ?, ?, ?)
      `).run(projectPath, projectName, new Date().toISOString(), branch);
    } else {
      this.db.prepare(`
        UPDATE projects SET last_used = ?, default_branch = ? WHERE path = ?
      `).run(new Date().toISOString(), branch, projectPath);
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
    const baseBranch = options.baseBranch || project.defaultBranch;
    
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
4. When you receive new requests via tmux, APPEND them to the TASK.md file in .claude-o
   - Use \`echo "\\n## Update: $(date)" >> .claude-o/*_${task.taskName}-*.task.md\`
   - Then append the new request details
5. Create .task_complete when done

## Testing & Validation
Before marking complete, run sanity checks appropriate for this codebase:

**Auto-detect the project type and run appropriate commands:**
- JavaScript/TypeScript: Check for package.json, run npm test/yarn test/pnpm test, then build
- Go: Check for go.mod, run go test ./... && go build ./...
- Rust: Check for Cargo.toml, run cargo test && cargo clippy && cargo build
- Python: Check for setup.py/pyproject.toml, run pytest or python -m unittest
- C/C++: Check for Makefile/CMakeLists.txt, run make test or ctest
- Other: Look for common test scripts or ask user

**You MUST verify the code works before completing!**
The merge tool does NOT run tests - you are responsible for quality.

## Completion Checklist
When done:
1. **DETECT PROJECT TYPE** - Look for package.json, Cargo.toml, go.mod, etc.
2. **RUN APPROPRIATE TESTS/BUILDS** - Based on what you found:
   - Node.js: npm/yarn/pnpm test && build
   - Go: go test ./... && go build
   - Rust: cargo test && cargo build
   - Python: pytest or unittest
   - C/C++: make test && make
   - If unsure, ask the user what to run
3. **COMMIT ALL YOUR WORK** - Run git add -A && git commit with descriptive message
4. Create .claude-o/<timestamp>_${task.taskName}-${task.id.substring(0, 8)}.task_complete with summary
5. **COMMIT TASK FILES** - Run git add .claude-o && git commit -m "docs: task complete"
   This archives the task for history - all files in .claude-o will be merged and kept
6. Ask user if they want to merge the task back to ${task.baseBranch}
7. If yes, use mcp__claude-o__merge_task tool (only merges - no tests)

IMPORTANT:
- **YOU MUST DETECT and run the right tests!** Don't use hardcoded commands.
- Run tests BEFORE asking to merge! The merge tool will NOT run them.
- Never ask to merge without committing all changes first!
- Be smart about the codebase - inspect files to determine what to run.

Note: Task completion files use migration-style naming (timestamp first).
Example: .claude-o/2025-10-22T21-24-51-112_${task.taskName}-${task.id.substring(0, 8)}.task_complete
`
    };

    // Create .claude-o directory in worktree
    const claudeODir = path.join(task.worktreePath, '.claude-o');
    if (!fs.existsSync(claudeODir)) {
      fs.mkdirSync(claudeODir, { recursive: true });
    }

    // Use timestamp for unique filenames (migration-style: timestamp first)
    const timestamp = task.createdAt.replace(/[:.]/g, '-').replace('Z', '');
    const shortId = task.id.substring(0, 8);

    // Write context files with unique names in .claude-o folder
    // Format: <timestamp>_<task-name>-<short-id>
    const filePrefix = `${timestamp}_${task.taskName}-${shortId}`;

    // Write context JSON
    fs.writeFileSync(
      path.join(claudeODir, `${filePrefix}.context.json`),
      JSON.stringify(contextData, null, 2)
    );

    // Write TASK.md ONLY in .claude-o (versioned, no conflicts)
    const taskMdPath = path.join(claudeODir, `${filePrefix}.task.md`);
    fs.writeFileSync(taskMdPath, contextData.instructions);
  }
  
  sendCommandToTask(taskNameOrId: string, command: string, projectPath?: string): void {
    let project: Project | undefined;

    // Try to detect project if not provided
    if (projectPath) {
      project = this.getProject(projectPath);
    } else {
      try {
        project = this.detectProject();
      } catch (error) {
        project = undefined;
      }
    }

    // Find the task
    let task: GlobalTask | undefined;

    if (project) {
      task = this.db.prepare(`
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
    } else {
      task = this.db.prepare(`
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
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(taskNameOrId, `${taskNameOrId}%`) as GlobalTask | undefined;
    }

    if (!task) {
      console.error(`❌ Task not found: ${taskNameOrId}`);
      return;
    }

    // Get tmux session from metadata
    // Note: metadata comes from SQLite as a string (JSON), need to parse it
    const metadata = task.metadata
      ? (typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata)
      : {};
    const tmuxSession = metadata.tmuxSession;

    if (!tmuxSession) {
      console.error(`❌ No tmux session found for task: ${task.taskName}`);
      console.log('   This task may have been created before tmux integration.');
      return;
    }

    // Send command to tmux session
    try {
      execSync(`tmux send-keys -t ${JSON.stringify(tmuxSession)} ${JSON.stringify(command)} C-m`, { stdio: 'inherit' });
      console.log(`✅ Command sent to ${task.taskName} (session: ${tmuxSession})`);
    } catch (error: any) {
      console.error(`❌ Failed to send command: ${error.message}`);
      console.log(`   Session may have been closed. Try: tmux attach -t ${tmuxSession}`);
    }
  }

  private launchClaude(task: GlobalTask) {
    // Get the appropriate provider
    const provider = getProvider(this.settings);

    // Validate provider configuration
    const validationError = provider.validate(this.settings);
    if (validationError) {
      console.error(`❌ ${validationError}`);
      throw new Error(validationError);
    }

    // Launch the provider
    const tmuxSession = provider.launch(task, this.settings);

    // Store session info in task metadata if available
    if (tmuxSession) {
      this.db.prepare(`
        UPDATE tasks
        SET metadata = ?
        WHERE id = ?
      `).run(JSON.stringify({ tmuxSession }), task.id);
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
      // Check for completion file in .claude-o folder
      const claudeODir = path.join(task.worktreePath, '.claude-o');
      let isComplete = false;

      // Check if .claude-o directory exists and has any .task_complete files
      if (fs.existsSync(claudeODir)) {
        const files = fs.readdirSync(claudeODir);
        isComplete = files.some(file => file.endsWith('.task_complete'));
      }

      // Also check legacy location for backwards compatibility
      if (!isComplete) {
        const legacyCompletePath = path.join(task.worktreePath, '.task_complete');
        isComplete = fs.existsSync(legacyCompletePath);
      }

      if (isComplete) {
        console.log(`✅ Task ready: ${task.taskName}`);
        completed++;

        if (this.settings.autoMerge) {
          if (this.mergeTask(task)) {
            merged++;
          }
        } else {
          console.log(`   ⚠️  autoMerge is disabled. Run 'co merge ${task.id.substring(0, 8)}' to merge manually.`);
        }
      }
    });
    
    return { checked: activeTasks.length, completed, merged };
  }
  
  private mergeTask(task: GlobalTask): boolean {
    const originalCwd = process.cwd();

    try {
      // Work in project path, not worktree (which might get deleted)
      process.chdir(task.projectPath);

      // Check if worktree still exists
      if (!fs.existsSync(task.worktreePath)) {
        console.error(`\n❌ Worktree not found: ${task.worktreePath}`);
        console.log('   The worktree may have been deleted. Cannot merge.');
        process.chdir(originalCwd);
        return false;
      }

      // Revert files that should not be merged (settings.local.json, TASK.md in root)
      console.log('\n🔄 Reverting files that should not be merged...');

      // Revert settings.local.json if it exists
      const settingsLocalPath = path.join(task.worktreePath, 'settings.local.json');
      if (fs.existsSync(settingsLocalPath)) {
        try {
          execSync(`git -C "${task.worktreePath}" checkout ${task.baseBranch} -- settings.local.json`, { stdio: 'pipe' });
          console.log('   ✅ Reverted settings.local.json to base branch version');
        } catch (error) {
          // File might not exist in base branch, that's okay
        }
      }

      // Remove TASK.md from root if it exists (should only be in .claude-o)
      const taskMdRootPath = path.join(task.worktreePath, 'TASK.md');
      if (fs.existsSync(taskMdRootPath)) {
        try {
          fs.unlinkSync(taskMdRootPath);
          console.log('   ✅ Removed TASK.md from root (kept in .claude-o)');
        } catch (error) {
          // Ignore if can't delete
        }
      }

      // Ensure all changes are committed in the worktree
      const gitStatus = execSync(`git -C "${task.worktreePath}" status --porcelain`, { encoding: 'utf-8' }).trim();
      if (gitStatus) {
        console.log('\n📝 Uncommitted changes detected. Committing all changes...');
        try {
          execSync(`git -C "${task.worktreePath}" add -A`, { stdio: 'inherit' });
          execSync(`git -C "${task.worktreePath}" commit -m "fix: ${task.taskName}\n\nCompleted by Claude orchestrator"`, { stdio: 'inherit' });
          console.log('✅ Changes committed');
        } catch (error) {
          console.error('❌ Failed to commit changes. Please commit manually.');
          process.chdir(originalCwd);
          return false;
        }
      }

      // Merge back to base branch (simple - no tests, no builds)
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf-8'
      }).trim();

      console.log(`\n🔀 Merging ${task.branch} into ${task.baseBranch}...`);

      execSync(`git checkout ${task.baseBranch}`, { stdio: 'inherit' });
      execSync(`git merge --no-ff ${task.branch} -m "Merge: ${task.taskName} (automated)"`, { stdio: 'inherit' });

      console.log(`✅ Merged ${task.taskName} into ${task.baseBranch}`);

      // Clean up worktree
      console.log('\n🗑️  Cleaning up worktree...');
      execSync(`git worktree remove "${task.worktreePath}"`, { stdio: 'inherit' });

      // Update database
      this.db.prepare(`
        UPDATE tasks
        SET status = 'merged', completed_at = ?, merged_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), task.id);

      // Return to original branch
      if (currentBranch && currentBranch !== task.baseBranch) {
        execSync(`git checkout ${currentBranch}`, { stdio: 'inherit' });
      }

      process.chdir(originalCwd);
      this.logTask('merge', task);
      return true;

    } catch (error: any) {
      console.error(`\n❌ Merge failed!`);
      console.error(`\nError: ${error.message}`);

      // Try to extract more detailed error information
      if (error.stderr) {
        const stderr = error.stderr.toString();
        console.error(`\nDetails:\n${stderr}`);

        // Provide helpful hints based on error type
        if (stderr.includes('CONFLICT')) {
          console.log('\n💡 Merge conflict detected. To resolve:');
          console.log(`   1. cd ${task.projectPath}`);
          console.log(`   2. Resolve conflicts in the files`);
          console.log(`   3. git add <resolved-files>`);
          console.log(`   4. git commit`);
          console.log(`   5. Try merging again with: co merge ${task.id.substring(0, 8)}`);
        } else if (stderr.includes('not something we can merge')) {
          console.log('\n💡 Branch not found. The worktree branch may have been deleted.');
        } else if (stderr.includes('Please commit your changes')) {
          console.log('\n💡 Uncommitted changes in main repo. Commit or stash them first.');
        }
      }

      console.log(`\n⚠️  Task remains active. Fix the issues above and try again.`);

      try {
        process.chdir(originalCwd);
      } catch (e) {
        // Ignore chdir errors in cleanup
      }

      return false;
    }
  }

  manualMerge(taskNameOrId: string, options: { projectPath?: string } = {}): void {
    let project: Project | undefined;

    // Try to detect project if not provided
    if (options.projectPath) {
      project = this.getProject(options.projectPath);
    } else {
      try {
        project = this.detectProject();
      } catch (error) {
        // Not in a git repo, will search all projects
        project = undefined;
      }
    }

    // Find the task - allow both active and completed tasks
    // Support both task name and task ID (or partial ID)
    let task: GlobalTask | undefined;

    if (project) {
      // Search within specific project
      task = this.db.prepare(`
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
    } else {
      // Search across all projects
      task = this.db.prepare(`
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
          AND status IN ('active', 'completed')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(taskNameOrId, `${taskNameOrId}%`) as GlobalTask | undefined;
    }

    if (!task) {
      console.error(`❌ Task not found: ${taskNameOrId}`);
      console.log(`   Only active or completed tasks can be merged.`);
      return;
    }

    console.log(`\n🔀 Merging task: ${task.taskName}\n`);

    if (this.mergeTask(task)) {
      console.log(`\n✅ Successfully merged ${task.taskName}`);
    } else {
      console.log(`\n❌ Merge failed. Please resolve conflicts.`);
    }
  }

  closeTask(taskNameOrId: string, projectPath?: string): void {
    let project: Project | undefined;

    // Try to detect project if not provided
    if (projectPath) {
      project = this.getProject(projectPath);
    } else {
      try {
        project = this.detectProject();
      } catch (error) {
        // Not in a git repo, will search all projects
        project = undefined;
      }
    }

    // Find the task - support both task name and task ID (or partial ID)
    let task: GlobalTask | undefined;

    if (project) {
      // Search within specific project
      task = this.db.prepare(`
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
    } else {
      // Search across all projects
      task = this.db.prepare(`
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
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(taskNameOrId, `${taskNameOrId}%`) as GlobalTask | undefined;
    }

    if (!task) {
      console.error(`❌ Task not found: ${taskNameOrId}`);
      return;
    }

    try {
      console.log(`✅ Closing task: ${task.taskName}`);
      console.log(`   This marks the task as completed but keeps the worktree and branch.`);
      console.log(`   Worktree: ${task.worktreePath}`);
      console.log(`   Branch: ${task.branch}`);

      // Update database to mark as completed
      this.db.prepare(`
        UPDATE tasks
        SET status = 'completed', completed_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), task.id);

      console.log(`✅ Task closed: ${task.taskName}`);
      console.log(`   Use 'co merge ${task.id.substring(0, 8)}' to merge it later.`);
      console.log(`   Use 'co kill ${task.id.substring(0, 8)}' to delete it without merging.`);

      this.logTask('close', task);

    } catch (error: any) {
      console.error(`❌ Failed to close task: ${error.message}`);
      throw error;
    }
  }

  killTask(taskNameOrId: string, projectPath?: string): void {
    let project: Project | undefined;

    // Try to detect project if not provided
    if (projectPath) {
      project = this.getProject(projectPath);
    } else {
      try {
        project = this.detectProject();
      } catch (error) {
        // Not in a git repo, will search all projects
        project = undefined;
      }
    }

    // Find the task - support both task name and task ID (or partial ID)
    let task: GlobalTask | undefined;

    if (project) {
      // Search within specific project
      task = this.db.prepare(`
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
    } else {
      // Search across all projects
      task = this.db.prepare(`
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
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(taskNameOrId, `${taskNameOrId}%`) as GlobalTask | undefined;
    }

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
      `).run(task.projectPath);

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
      SELECT
        path,
        name,
        last_used as lastUsed,
        default_branch as defaultBranch,
        task_count as taskCount
      FROM projects
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