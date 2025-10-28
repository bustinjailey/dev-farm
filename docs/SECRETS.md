# Secret Management

This document explains how to manage secrets securely in Dev Farm without committing them to source control.

## Quick Setup

### 1. Create Your .env File

```bash
# Copy the example file
cp .env.example .env

# Edit with your values
nano .env  # or use your preferred editor
```

### 2. Required Configuration

Add your GitHub Personal Access Token to `.env`:

```bash
GITHUB_TOKEN=ghp_your_actual_token_here
GITHUB_USERNAME=bustinjailey
GITHUB_EMAIL=your-email@example.com
```

### 3. Get a GitHub Token

1. Visit: https://github.com/settings/tokens/new
2. Required scopes:
   - `repo` (Full control of private repositories)
   - `read:org` (Read org and team membership)
   - `workflow` (Update GitHub Action workflows)
   - `copilot` (GitHub Copilot access)
3. Copy the generated token to your `.env` file

## Files That Are Ignored

The following files are automatically ignored by git and will never be committed:

- `.env` - Your main configuration file with secrets
- `.env.local` - Local override file
- `PAT` - Personal Access Token file (legacy support)
- `*.secret` - Any file ending in .secret

## Using the PAT File (Alternative)

If you prefer, you can use a `PAT` file instead of `.env`:

```bash
echo "ghp_your_token_here" > PAT
```

The upgrade script will automatically detect and use this file.

## Upgrade Process

The `scripts/upgrade.sh` script handles secrets securely:

1. Loads token from `PAT` file or `.env`
2. Uses token for authentication during git pull
3. Removes token from git remote URL after update
4. Passes secrets to containers via environment variables

### Running the Upgrade

```bash
# From the dev-farm directory
./scripts/upgrade.sh
```

Or on a remote LXC:

```bash
ssh root@your-proxmox-host 'pct exec CONTAINER_ID -- bash -c "cd /opt && ./scripts/upgrade.sh"'
```

## How Secrets Flow

```
Local Machine            LXC Container           Docker Container
------------            --------------          -----------------
PAT file or        →    .env file          →    Environment vars
.env file                                        (GITHUB_TOKEN,
                                                  GITHUB_USERNAME,
                                                  GITHUB_EMAIL)
```

### For New Environments

1. Dashboard reads `.env` file
2. Extracts `GITHUB_TOKEN`, `GITHUB_USERNAME`, `GITHUB_EMAIL`
3. Passes them to container via environment variables
4. Container's `startup.sh` uses them to:
   - Configure git
   - Authenticate GitHub CLI
   - Setup git credential helper
   - Enable GitHub Copilot

## Security Best Practices

### ✅ DO

- Store secrets in `.env` or `PAT` files
- Use environment variables for sensitive data
- Rotate tokens regularly
- Use minimal required token scopes
- Keep `.gitignore` updated

### ❌ DON'T

- Commit secrets to git
- Share your `.env` file
- Put secrets in code or config files tracked by git
- Use tokens with excessive permissions
- Reuse tokens across multiple systems

## Troubleshooting

### Token Not Working

```bash
# Check if token is loaded
cd /opt
cat .env | grep GITHUB_TOKEN

# Verify in dashboard logs
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
3. Update `.env` file
4. Restart dashboard: `docker compose restart`

## Moving Between Systems

When deploying to a new system:

```bash
# On your local machine
scp .env root@remote:/opt/.env

# Or create it remotely
ssh root@remote
cd /opt
cp .env.example .env
nano .env  # Add your secrets
```

## Backup Strategy

**Never backup secrets to git!**

Safe backup methods:

1. **Password Manager** - Store tokens in 1Password, Bitwarden, etc.
2. **Encrypted Backup** - Use encrypted storage for `.env` files
3. **Secure Notes** - Keep in secure physical or digital notes

## Reference

- [GitHub Token Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Environment Variable Best Practices](https://12factor.net/config)
- [.env File Format](https://github.com/bkeepers/dotenv#usage)
