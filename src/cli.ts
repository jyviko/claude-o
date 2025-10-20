#!/usr/bin/env node

import { ClaudeOrchestrator } from './orchestrator';
import { spawn_task } from './tools';

const orchestrator = new ClaudeOrchestrator();

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'spawn':
    if (args.length < 2) {
      console.error('Usage: ohclaude spawn <name> <description>');
      process.exit(1);
    }
    orchestrator.spawnTask(args[0], args[1]);
    break;
    
  case 'check':
    orchestrator.checkCompletedTasks();
    break;
    
  case 'list':
    orchestrator.listTasks();
    break;
    
  case 'tool-handler':
    // This is called when Claude uses a tool
    const toolName = args[0];
    const toolArgs = JSON.parse(args[1]);
    
    if (toolName === 'spawn_task') {
      const result = spawn_task(toolArgs);
      console.log(JSON.stringify(result));
    }
    break;
    
  default:
    console.log(`
Claude Orchestrator - Manage isolated Claude tasks

Usage:
  ohclaude spawn <name> <description>  - Spawn new task
  ohclaude check                       - Check and merge completed tasks  
  ohclaude list                        - List all tasks
    `);
}
