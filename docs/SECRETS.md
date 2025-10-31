# Secret Management

This document explains how to manage secrets securely in Dev Farm without committing them to source control.

## Quick Setup

### 1. Create Your farm.config File

```bash
# Copy the example file
cp farm.config.example farm.config

# Set secure permissions (readable only by owner)
chmod 600 farm.config

# Edit with your values
nano farm.config  # or use your preferred editor

# Validate JSON syntax
cat farm.config | python3 -m json.tool
```

### 2. Required Configuration

Add your GitHub Personal Access Token to `farm.config`:

```json
{
  "version": "1.0",
  "github": {
    "personal_access_token": "ghp_your_actual_token_here",
    "username": "your-github-username",
    "email": "your-email@example.com"
  },
  "mcp": {
    "api_keys": {
      "brave_search": ""
    }
  }
}
```

**Important:** farm.config must be valid JSON. Common mistakes to avoid:
- Don't forget commas between fields
- Don't add trailing commas after the last field in an object
- Use double quotes ("), not single quotes (')
- Ensure proper bracket matching: { } and [ ]

### 3. Get a GitHub Token

1. Visit: https://github.com/settings/tokens/new
2. Required scopes:
   - `repo` (Full control of private repositories)
   - `read:org` (Read org and team membership)
   - `workflow` (Update GitHub Action workflows)
   - `copilot` (GitHub Copilot access)
3. Copy the generated token to your `farm.config` file

## Files That Are Ignored

The following files are automatically ignored by git and will never be committed:

- `farm.config` - Your main configuration file with secrets
- `.env` - Legacy environment file (no longer used)
- `.env.local` - Local override file
- `*.secret` - Any file ending in .secret

## Configuration Format

Dev Farm uses a JSON configuration file (`farm.config`) for all settings:

```json
{
  "version": "1.0",
  "github": {
    "personal_access_token": "ghp_...",
    "username": "your-username",
    "email": "your-email@example.com"
  },
  "mcp": {
    "api_keys": {
      "brave_search": "BSA_..."
    }
  }
}
```

## System Update

The dashboard's built-in update system handles secrets securely:

1. Reads configuration from `farm.config`
2. Uses token for authentication during git operations
3. Passes secrets to containers via environment variables
4. No secrets stored in git or Docker images

### Running Updates

Use the dashboard UI:
1. Click "⬆️ Update Now" button
2. System automatically pulls latest code and rebuilds
3. Configuration is preserved in `farm.config`

## How Secrets Flow

```
farm.config File     →    Dashboard Process    →    Container Environment
----------------          ------------------        ---------------------
JSON configuration        Loads from file           GITHUB_TOKEN
- GitHub token            Parses JSON               GITHUB_USERNAME
- GitHub username         Validates                 GITHUB_EMAIL
- GitHub email            Passes to containers      BRAVE_API_KEY
- API keys                                          (environment vars)
```

### For New Environments

1. Dashboard reads `farm.config` file
2. Extracts GitHub credentials and API keys
3. Passes them to container via environment variables
4. Container's `startup.sh` uses them to:
   - Configure git
   - Authenticate GitHub CLI
   - Setup git credential helper
   - Enable GitHub Copilot
   - Configure MCP servers

## Security Best Practices

### ✅ DO

- Store secrets in `farm.config`
- Use JSON format for structured configuration
- Rotate tokens regularly
- Use minimal required token scopes
- Keep `.gitignore` updated
- Set file permissions: `chmod 600 farm.config`

### ❌ DON'T

- Commit secrets to git
- Share your `farm.config` file
- Put secrets in code or config files tracked by git
- Use tokens with excessive permissions
- Reuse tokens across multiple systems

## Troubleshooting

### Token Not Working

```bash
# Check if config file exists
cd /opt/dev-farm
ls -la farm.config

# Verify JSON syntax
cat farm.config | python3 -m json.tool

# Check dashboard logs
docker logs devfarm-dashboard | grep -i github
```

### Environment Not Authenticated

```bash
# Check container environment
docker exec devfarm-ENVNAME env | grep GITHUB

# Check GitHub CLI status
docker exec -it devfarm-ENVNAME gh auth status
```

### Regenerate Token

1. Revoke old token: https://github.com/settings/tokens
2. Generate new token with same scopes
3. Update `farm.config` file:
   ```bash
   nano farm.config
   # Update "personal_access_token" value
   ```
4. No restart needed - changes apply to new containers

## Managing Configuration via Dashboard

You can also manage your GitHub configuration through the dashboard UI:

1. Open dashboard in browser
2. Look for GitHub connection status in header
3. Click "🔗 Connect" to authenticate via OAuth
4. Or use "⚙️ Settings" to manually enter a PAT

The dashboard will update `farm.config` automatically.

## Moving Between Systems

When deploying to a new system:

```bash
# Copy config securely
scp farm.config root@remote:/opt/dev-farm/farm.config

# Or create it remotely
ssh root@remote
cd /opt/dev-farm
cp farm.config.example farm.config
nano farm.config  # Add your secrets
chmod 600 farm.config
```

## Backup Strategy

**Never backup secrets to git!**

Safe backup methods:

1. **Password Manager** - Store tokens in 1Password, Bitwarden, etc.
2. **Encrypted Backup** - Use encrypted storage for `farm.config`
3. **Secure Notes** - Keep in secure physical or digital notes

## Migration from .env

If you're upgrading from an older version that used `.env`:

```bash
# Old .env format (deprecated)
GITHUB_TOKEN=ghp_...
GITHUB_USERNAME=bustinjailey
GITHUB_EMAIL=user@example.com

# New farm.config format (current)
{
  "github": {
    "personal_access_token": "ghp_...",
    "username": "bustinjailey",
    "email": "user@example.com"
  }
}
```

Steps to migrate:
1. Create `farm.config` from `farm.config.example`
2. Copy values from your `.env` file
3. Delete `.env` file (no longer used)
4. Restart dashboard: `docker compose restart`

## Reference

- [GitHub Token Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [JSON Configuration Format](https://www.json.org/)
- [Configuration Best Practices](https://12factor.net/config)
