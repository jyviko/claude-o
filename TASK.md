
# Task: test-task

## Description
This is a test task

## Project
- Name: claude-o
- Path: ~/Sources/claude-o
- Branch: fix/test-task-1761048603160
- Base: features/test

## Instructions
1. Work ONLY on this specific task
2. Do not refactor unrelated code
3. Stay in this worktree directory
4. Create .task_complete when done

## Testing
Before marking complete:
- Run: yarn test
- Run: yarn build

## Completion
When done:
1. Create .task_complete with a summary of changes
2. Ask the user if they want to merge the task back to features/test
3. If yes, use the mcp__claude-o__merge_task tool to merge this task
