# AI Extensions Configuration

This document describes the AI extensions configured in Dev Farm environments and their default model settings.

## Installed Extensions

The following AI coding assistant extensions are automatically installed in all Dev Farm environments:

1. **Kilo Code** (`kilocode.kilocode`) - AI-powered coding assistant
2. **Cline** (`saoudrizwan.claude-dev`) - Claude-powered development assistant
3. **GitHub Copilot Chat** (`github.copilot-chat`) - GitHub's AI pair programmer
4. **ChatGPT** (`openai.chatgpt`) - OpenAI integration for VS Code

## Default Model Configuration

All AI extensions are pre-configured to use **Claude Sonnet 4.5** as their default model for coding tasks:

### GitHub Copilot
- **Chat Model**: `claude-sonnet-4.5`
- **Setting**: `github.copilot.chat.model`

### ChatGPT Extension
- **Provider**: `github-copilot`
- **Model**: `claude-sonnet-4.5`
- **Settings**: `chatgpt.provider`, `chatgpt.model`

### Cline (Claude Dev)
- **API Provider**: `anthropic`
- **Model**: `claude-sonnet-4-20250514`
- **Settings**: `cline.apiProvider`, `cline.anthropicModel`

### Kilo Code
- **API Provider**: `anthropic`
- **Default Model**: `claude-sonnet-4.5`
- **Settings**: `kilocode.apiProvider`, `kilocode.defaultModel`

## Configuration Files

### Extension Installation
Extensions are installed via [`docker/config/startup.sh`](../docker/config/startup.sh):
```bash
install_extension_with_retry "kilocode.kilocode" || true
install_extension_with_retry "saoudrizwan.claude-dev" || true
install_extension_with_retry "github.copilot-chat" || true
install_extension_with_retry "openai.chatgpt" || true
```

### Workspace Settings
Model preferences are configured in [`docker/config/workspace-settings.json`](../docker/config/workspace-settings.json):
```json
{
  "github.copilot.chat.model": "claude-sonnet-4.5",
  "chatgpt.provider": "github-copilot",
  "chatgpt.model": "claude-sonnet-4.5",
  "cline.apiProvider": "anthropic",
  "cline.anthropicModel": "claude-sonnet-4-20250514",
  "cline.apiKey": "",
  "kilocode.defaultModel": "claude-sonnet-4.5",
  "kilocode.apiProvider": "anthropic"
}
```

## Authentication

### GitHub Copilot
Requires GitHub authentication via the VS Code Accounts menu or Command Palette (`Ctrl+Shift+P` → `GitHub: Sign In`).

### Anthropic Extensions (Cline, Kilo Code)
Require an Anthropic API key to be configured:
1. Obtain an API key from [Anthropic Console](https://console.anthropic.com/)
2. Configure via VS Code settings:
   - For Cline: Set `cline.apiKey`
   - For Kilo Code: Configure through extension settings

## Benefits of Claude Sonnet 4.5

Claude Sonnet 4.5 offers several advantages for coding tasks:
- **Extended Context**: Handles large codebases effectively
- **Code Understanding**: Superior comprehension of complex code structures
- **Reasoning**: Strong logical reasoning for debugging and architecture
- **Latest Model**: Most recent version with improved capabilities
- **Consistency**: Unified experience across all AI coding assistants

## Customization

Users can override these defaults by:
1. Modifying workspace settings (`.vscode/settings.json`)
2. Changing user settings in VS Code
3. Using extension-specific configuration UIs

## Troubleshooting

### Extension Not Working
1. Check if the extension is installed: View → Extensions
2. Verify authentication (for Copilot) or API key (for Anthropic extensions)
3. Check extension output panel for errors

### Model Selection Issues
1. Ensure your account/API key has access to Claude Sonnet 4.5
2. Check for extension updates in VS Code
3. Review workspace settings for correct model identifiers

## Related Documentation

- [Dev Farm Setup Guide](../README.md)
- [MCP Configuration](MCP_VERIFICATION.md)
- [Terminal Mode](TERMINAL_MODE.md)