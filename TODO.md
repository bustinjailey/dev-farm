## Completed (2025-10-30)

✅ **Auto-approve for basic commands** - Added auto-approval lists to auto-approval-settings.json for Cline and GitHub Copilot. Common commands (ls, cd, cat, grep, git status, npm, etc.) now execute without user approval.

✅ **Markdown preview fixed** - Removed incorrect editorAssociations, added proper markdown.preview settings. Use right-click → "Open Preview" or Ctrl+Shift+V.

✅ **Aggregate-mcp-server 403 error fixed** - Public repos don't need authentication. Removed OAuth credential helper for MCP server clone. Now clones directly via HTTPS.

✅ **Clean slate for new environments** - Added window.restoreWindows/restoreFullscreen/restoreViewState settings. Each environment starts fresh without stale tabs from previous sessions.

✅ **Terminal opens at bottom** - Changed workbench.panel.defaultLocation from "right" to "bottom".

✅ **Git mode workspace mounting** - Added --default-folder parameter to VS Code Server. Git mode now correctly opens /home/coder/repo.

✅ **Removed duplicate GH_TOKEN** - Simplified token handling. Only GITHUB_TOKEN needed (gh CLI and Copilot both use it).

✅ **Documented OAuth vs PAT limitations** - Created docs/GITHUB_AUTH_LIMITATIONS.md explaining why OAuth tokens can't push and how to use Personal Access Tokens.