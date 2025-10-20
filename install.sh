#!/bin/bash
# ~/.ohclaude/install.sh

echo "🚀 Installing Claude Orchestrator..."

INSTALL_DIR="$HOME/Sources/ohclaude"
cd "$INSTALL_DIR"

# Install dependencies
echo "📦 Installing dependencies..."
yarn install

# Build TypeScript
echo "🔨 Building..."
yarn build

# Make executable
chmod +x dist/bin/co.js

# Detect shell and add alias
echo "🔧 Setting up shell alias..."

# Detect current shell
CURRENT_SHELL=$(basename "$SHELL")

# Determine the appropriate RC file
case "$CURRENT_SHELL" in
  zsh)
    RC_FILE="$HOME/.zshrc"
    ;;
  bash)
    # Check for .bashrc first, then .bash_profile
    if [ -f "$HOME/.bashrc" ]; then
      RC_FILE="$HOME/.bashrc"
    else
      RC_FILE="$HOME/.bash_profile"
    fi
    ;;
  fish)
    RC_FILE="$HOME/.config/fish/config.fish"
    mkdir -p "$HOME/.config/fish"
    ;;
  *)
    echo "⚠️  Unknown shell: $CURRENT_SHELL"
    echo "Please manually add this alias to your shell config:"
    echo "alias co='node $INSTALL_DIR/dist/bin/co.js'"
    RC_FILE=""
    ;;
esac

# Add alias if RC file was determined
if [ -n "$RC_FILE" ]; then
  # Check if alias already exists
  if grep -q "alias co=" "$RC_FILE" 2>/dev/null; then
    echo "⚠️  'co' alias already exists in $RC_FILE"
  else
    echo "" >> "$RC_FILE"
    echo "# Claude Orchestrator alias" >> "$RC_FILE"
    echo "alias co='node $INSTALL_DIR/dist/bin/co.js'" >> "$RC_FILE"
    echo "✅ Added 'co' alias to $RC_FILE"
  fi
fi

# Install Claude tools config
echo "🔧 Installing Claude CLI tools..."
mkdir -p ~/.claude

if [ -f ~/.claude/tools.json ]; then
  echo "⚠️  ~/.claude/tools.json already exists, backing up to ~/.claude/tools.json.backup"
  cp ~/.claude/tools.json ~/.claude/tools.json.backup
fi

cp ~/.ohclaude/example-claude-tools.json ~/.claude/tools.json
echo "✅ Claude tools config installed to ~/.claude/tools.json"

echo ""
echo "✅ Installation complete!"
echo ""
echo "Usage:"
echo "  co spawn <name> <description> - Spawn a new task"
echo "  co check                      - Check completed tasks"
echo "  co list                       - List all tasks"
echo ""
echo "Try: co spawn test-task 'This is a test task'"