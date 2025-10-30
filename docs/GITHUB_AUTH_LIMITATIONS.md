# GitHub Authentication Limitations

## Overview

Dev Farm supports GitHub authentication through two methods:
1. **OAuth Device Flow** (via dashboard UI)
2. **Personal Access Token** (via environment variable or manual `gh auth login`)

Each method has different capabilities and limitations.

## OAuth Device Flow (Dashboard UI)

**How it works:**
- Click "Connect GitHub" in dashboard
- Follow device code authorization flow
- Token is saved to `/data/.github_token`
- Automatically shared with all environments

**OAuth App Configuration:**
- Client ID: `Iv1.b507a08c87ecfe98`
- Scopes requested: `repo`, `read:org`, `workflow`, `copilot`

**Limitations:**
- **Repository Push Access**: OAuth App tokens may have restricted push access to repositories, even with the `repo` scope
- GitHub treats OAuth Apps differently than Personal Access Tokens (PATs)
- Some repository operations may require fine-grained permissions not available to OAuth Apps
- Token permissions depend on OAuth App configuration in GitHub settings

**Best for:**
- Read-only repository operations (clone, pull, fetch)
- GitHub Copilot authentication
- Reading organization data
- Triggering workflows
- Convenience (no manual token management)

## Personal Access Token (PAT)

**How it works:**
- Create a classic PAT at https://github.com/settings/tokens
- Set `GITHUB_TOKEN` environment variable in dashboard when creating environment
- Or run `gh auth login` inside the environment and authenticate interactively

**Token Scopes (recommended):**
- `repo` - Full control of private repositories
- `read:org` - Read org and team membership
- `workflow` - Update GitHub Actions workflows (optional)
- `gist` - Create gists (optional)

**Advantages:**
- **Full push access** to your repositories
- More granular permission control
- Works with fine-grained tokens
- Direct authentication without OAuth App intermediary

**Best for:**
- Pushing code to repositories
- Full git operations (push, pull, clone)
- Working with private repositories
- Development workflows requiring write access

## Current Issue: OAuth Token Push Restrictions

### Problem

The OAuth App token created via dashboard device flow successfully authenticates with GitHub but is **denied write access** when pushing to repositories:

```
remote: Permission to bustinjailey/dev-farm.git denied to bustinjailey.
fatal: unable to access 'https://github.com/bustinjailey/dev-farm.git/': The requested URL returned error: 403
```

This occurs even though:
- The token has `repo` scope
- User is authenticated as repository owner
- Same user can push with `gh auth login` token

### Why This Happens

GitHub applies different security policies to OAuth Apps compared to PATs:

1. **OAuth App Restrictions**: GitHub OAuth Apps must request specific permissions and users must explicitly grant them during authorization
2. **Repository Access**: Even with `repo` scope, OAuth Apps may not have push access depending on:
   - Repository ownership settings
   - Organization policies
   - OAuth App approval status
3. **Fine-grained Permissions**: OAuth Apps use coarse-grained scopes while PATs can be fine-grained

### Solutions

#### Option 1: Use Personal Access Token for Push Operations

**Recommended for environments that need git push:**

1. Create a classic PAT at https://github.com/settings/tokens
2. Select scopes: `repo`, `read:org`, `workflow` (optional)
3. Copy the token
4. In Dev Farm dashboard, add token when creating environment OR
5. Inside environment, run:
   ```bash
   gh auth login
   # Select "Paste an authentication token"
   # Paste your PAT
   ```

#### Option 2: Use Interactive gh auth login

**Best for one-time setup:**

Inside the environment:
```bash
# Remove existing OAuth token
unset GITHUB_TOKEN
unset GH_TOKEN

# Login interactively
gh auth login
# Follow prompts - this creates a PAT with proper permissions
```

#### Option 3: Update OAuth App Configuration (Requires GitHub Org Admin)

If Dev Farm OAuth App is registered under a GitHub organization:

1. Go to GitHub Organization Settings → OAuth Apps
2. Find `Iv1.b507a08c87ecfe98`
3. Review and update permissions
4. May require re-authorization from users

**Note**: This option requires access to the OAuth App registration, which is typically controlled by the application owner (bustinjailey).

## Recommendations

### For Dashboard Enhancement

**Short term:**
1. ✅ Remove duplicate `GH_TOKEN` environment variable (only `GITHUB_TOKEN` needed)
2. 📝 Add warning in dashboard UI: "OAuth token has read-only access. For git push, use Personal Access Token."
3. 📝 Provide PAT input field in dashboard for users who need push access

**Long term:**
1. Support both OAuth and PAT in dashboard
2. Auto-detect token type and show capabilities
3. Allow token override per environment
4. Add "Switch to PAT" button in environment settings

### For Users

**If you only need read access** (clone, pull):
- ✅ Use dashboard OAuth - it's convenient and secure

**If you need git push:**
- ⚠️ Use Personal Access Token via:
  - Dashboard environment variable, OR
  - Manual `gh auth login` inside environment

**If you need both:**
- Use PAT for everything (covers both read and write)

## Technical Details

### Token Priority in startup.sh

The startup script checks for tokens in this order:

1. `GITHUB_TOKEN` environment variable (set via dashboard)
2. `/data/.github_token` file (OAuth token from dashboard)
3. No authentication (skips GitHub setup)

### How gh CLI Uses Tokens

The `gh` CLI checks environment variables in this order:
1. `GH_TOKEN`
2. `GITHUB_TOKEN`

Both work identically - it's just an alias. Dev Farm now only sets `GITHUB_TOKEN` to avoid confusion.

### Git Credential Helper

When `gh auth setup-git` runs, it configures git to use:

```bash
credential.helper = !gh auth git-credential
```

This makes git delegate authentication to `gh` CLI, which uses the `GITHUB_TOKEN` environment variable.

## References

- [GitHub OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [gh CLI Authentication](https://cli.github.com/manual/gh_auth_login)
- [Git Credential Helpers](https://git-scm.com/docs/gitcredentials)
