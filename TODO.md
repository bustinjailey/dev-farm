1.  Enable auto approve in all farm envs by default
auto approve many basic commands (env, grep, git, ls, cd, ssh, cat, pwd, echo, touch, rm, mv, cp, mkdir, rmdir, tree, find, head, tail, less, more, etc.)

2.  Markdown preview still doesn't work, why?

3.  The system is meant to provide the aggregate-mcp-server from my github repo in the logs below, but it gets auth errors each time.  WE must fix this.

2025-10-30T20:01:11.952134117Z ✓ Machine-level settings configured for all workspaces
2025-10-30T20:01:11.953396043Z Configuring auto-approval settings for AI tools...
2025-10-30T20:01:11.961396307Z ✓ Auto-approval configured for git mode with paths: /home/coder/repo
2025-10-30T20:01:11.970896954Z Machine-level settings updated for VS Code Server
2025-10-30T20:01:11.973462165Z Setting up GitHub authentication...
2025-10-30T20:01:12.035044616Z Note: GitHub CLI authentication configured via GITHUB_TOKEN environment variable
2025-10-30T20:01:12.055808306Z GitHub authentication completed successfully for bustinjailey!
2025-10-30T20:01:12.056298204Z Setting up Aggregate MCP Server...
2025-10-30T20:01:12.058250035Z Installing aggregate MCP server from GitHub...
2025-10-30T20:01:12.058871190Z Cloning into '/home/coder/.local/bin/aggregate-mcp-server'...
2025-10-30T20:01:12.437358247Z remote: Write access to repository not granted.
2025-10-30T20:01:12.437371502Z fatal: unable to access 'https://github.com/bustinjailey/aggregate-mcp-server.git/': The requested URL returned error: 403
2025-10-30T20:01:12.439816888Z ⚠ Failed to clone aggregate MCP server repository

4.  It seems like new farm envs try to open tabs from previous farm envs, even if the files in those tabs don't exist.  We need each new farm env to be a clean slate with only the default options from startup.sh and similar setup steps provided. 

5.  Terminal should open at the bottom of the IDE by default, not the side.