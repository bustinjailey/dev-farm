# VS Code Insiders Extension Compatibility Guide

## Overview

VS Code Insiders is the nightly build of VS Code that includes cutting-edge features and API changes. Some extensions, particularly those using proposed APIs, require special handling to work correctly.

## Known Issues and Solutions

### GitHub Copilot Chat Extension

**Problem**: The stable version of `github.copilot-chat` uses proposed APIs (`chatParticipantPrivate`, `languageModelDataPart`, `chatSessionsProvider`) that may be incompatible with the latest VS Code Insiders builds.

**Error Message**:

```
Error while installing extension github.copilot-chat: Can't install 'GitHub Copilot Chat' extension.
This extension is using the API proposals 'chatParticipantPrivate', 'languageModelDataPart' and
'chatSessionsProvider' that are not compatible with the current version of VS Code.
```

**Solution**: Install the **pre-release version** instead of the stable version.

```bash
code-insiders --install-extension github.copilot-chat --pre-release
```

**Why This Works**: Pre-release versions are built specifically for VS Code Insiders and include compatibility with the latest proposed APIs.

### Implementation in Dev Farm

The `startup.sh` script has been updated to:

1. Install `github.copilot` (stable version works fine)
2. Install `github.copilot-chat` with `--pre-release` flag
3. Fall back to stable version if pre-release fails
4. Properly detect installation failures by checking:
   - Exit codes
   - Error messages in output
   - "Not compatible" warnings

### Extension Installation Retry Logic

The `install_extension_with_retry()` function now:

- Attempts installation up to 3 times
- Captures full output from `code-insiders --install-extension`
- Detects error patterns:
  - "Error while installing"
  - "not compatible"
  - "Failed Installing Extensions"
- Returns proper exit codes to indicate success/failure
- Logs all output to `/home/coder/workspace/.devfarm/startup.log`

## Affected Extensions

Currently known extensions that may require pre-release versions:

1. **github.copilot-chat** - Requires pre-release for Insiders
2. **github.copilot** - Stable version works (for now)

Other extensions (Continue, Cline, GitLens, etc.) work fine with stable versions as they don't use these specific proposed APIs.

## Monitoring for Future Issues

Watch for these indicators of extension compatibility issues:

1. **During Container Startup**:

   - Check logs: `docker logs devfarm-<name>`
   - Look for "Error while installing" or "not compatible"
   - Check `/home/coder/workspace/.devfarm/startup.log` inside container

2. **In VS Code UI**:

   - Extensions may show as "Not Compatible"
   - Features may be missing or grayed out
   - Console errors about missing APIs

3. **VS Code Insiders Updates**:
   - Insiders updates daily
   - API proposals can change or be removed
   - Extensions need time to catch up

## Troubleshooting

### Extension Won't Install

1. **Check VS Code Insiders version**:

   ```bash
   code-insiders --version
   ```

2. **Try pre-release version**:

   ```bash
   code-insiders --install-extension <extension-id> --pre-release
   ```

3. **Check extension marketplace**:

   - Visit https://marketplace.visualstudio.com/items?itemName=<extension-id>
   - Check "Version History" for pre-release versions
   - Check "Q&A" for known issues

4. **Fallback options**:
   - Use stable VS Code instead of Insiders
   - Wait for extension to be updated
   - Use alternative extensions

### Extension Installed but Not Working

1. **Check extension host logs**:

   - In VS Code: `Help > Toggle Developer Tools > Console`
   - Look for activation errors

2. **Verify extension is enabled**:

   - `Ctrl+Shift+X` → Check extension status
   - May show "Requires reload" or "Not compatible"

3. **Check proposed API requirements**:
   - Some extensions need `--enable-proposed-api` flag
   - Dev Farm doesn't use this by default (security concern)

## Best Practices

1. **Always use pre-release for chat/AI extensions** on Insiders
2. **Monitor extension update frequency** - daily updates indicate active maintenance
3. **Keep VS Code Insiders updated** - but be prepared for breaking changes
4. **Test in staging** before deploying to production environments
5. **Have fallback** - maintain stable VS Code option for critical work

## References

- [VS Code Insiders](https://code.visualstudio.com/insiders/)
- [VS Code Extension API - Proposed APIs](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)
- [GitHub Copilot Chat Extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat)
- [VS Code Extension Compatibility Issues](https://github.com/microsoft/vscode/issues?q=is%3Aissue+label%3Aextension-compatibility)

## Update History

- **2025-10-30**: Fixed github.copilot-chat installation by using pre-release version
- **2025-10-29**: Migrated from code-server to official VS Code Insiders Server
- **2025-10-29**: Added improved error detection in extension installation

---

**Note**: This document will be updated as new compatibility issues are discovered and resolved.
