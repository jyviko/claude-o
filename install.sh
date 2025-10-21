#!/bin/bash

echo "🚀 Installing Claude Orchestrato (Claude-O)..."

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.claude-o"

echo "📁 Installing to $INSTALL_DIR"

cd "$SOURCE_DIR"

echo "📦 Installing dependencies..."
yarn install

echo "🔨 Building..."
yarn build

mkdir -p "$INSTALL_DIR"

echo "📋 Copying compiled files..."
rm -rf "$INSTALL_DIR/dist"
cp -r "$SOURCE_DIR/dist" "$INSTALL_DIR/"
cp "$SOURCE_DIR/package.json" "$INSTALL_DIR/"

echo "📦 Installing production dependencies in $INSTALL_DIR..."
cd "$INSTALL_DIR"
yarn install --production

chmod +x "$INSTALL_DIR/dist/bin/co.js"
chmod +x "$INSTALL_DIR/dist/src/mcp/server.js"

echo "🔧 Setting up shell alias..."

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

# Configure MCP Server for Claude Code
echo "🔧 Configuring MCP Server for Claude Code..."

# Use claude CLI to add the MCP server at user scope
echo "Adding MCP server using claude CLI..."
if command -v claude &> /dev/null; then
  claude mcp add --scope user --transport stdio claude-o -- node "$INSTALL_DIR/dist/src/mcp/server.js"
  echo "✅ MCP Server configured using claude CLI"
else
  echo "⚠️  'claude' command not found"
  echo "📝 Add the MCP server manually by running:"
  echo ""
  echo "  claude mcp add --scope user --transport stdio claude-o -- node $INSTALL_DIR/dist/src/mcp/server.js"
  echo ""
  echo "Or add it to your project's .mcp.json:"
  echo ""
  echo '{
  "mcpServers": {
    "claude-o": {
      "command": "node",
      "args": ["'$INSTALL_DIR'/dist/src/mcp/server.js"]
    }
  }
}'
  echo ""
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Usage:"
echo "  co spawn <name> <description> - Spawn a new task"
echo "  co check                      - Check completed tasks"
echo "  co list                       - List all tasks"
echo ""
echo "Try: co spawn test-task 'This is a test task'"