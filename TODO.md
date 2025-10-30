🤖 CLI AI Tools Available:
  • gh copilot - GitHub Copilot CLI
  • aichat or ai - Multi-model AI chat CLI

💡 Type commands for help:
  • gh copilot explain <command>
  • gh copilot suggest <task>
  • aichat --help

➜  workspace ls
WELCOME.txt
➜  workspace gh copilot
Your AI command line copilot.

Usage:
  copilot [command]

Examples:

$ gh copilot suggest "Install git"
$ gh copilot explain "traceroute github.com"


Available Commands:
  alias       Generate shell-specific aliases for convenience
  config      Configure options
  explain     Explain a command
  suggest     Suggest a command

Flags:
  -h, --help              help for copilot
      --hostname string   The GitHub host to use for authentication
  -v, --version           version for copilot

Use "copilot [command] --help" for more information about a command.
➜  workspace gh copilot suggest "hello"

? Allow GitHub to collect optional usage data to help us improve? This data does not include your queries.
> Yes

✗ Error: No valid GitHub CLI OAuth token detected

To get started with GitHub Copilot in the CLI, please run: gh auth login --web -h github.com to authenticate via web browser.

➜  workspace gh repo
Work with GitHub repositories.

USAGE
  gh repo <command> [flags]

GENERAL COMMANDS
  create:        Create a new repository
  list:          List repositories owned by user or organization

TARGETED COMMANDS
  archive:       Archive a repository
  autolink:      Manage autolink references
  clone:         Clone a repository locally
  delete:        Delete a repository
  deploy-key:    Manage deploy keys in a repository
  edit:          Edit repository settings
  fork:          Create a fork of a repository
  gitignore:     List and view available repository gitignore templates
  license:       Explore repository licenses
  rename:        Rename a repository
  set-default:   Configure default repository for this directory
  sync:          Sync a repository
  unarchive:     Unarchive a repository
  view:          View a repository

INHERITED FLAGS
  --help   Show help for command

ARGUMENTS
  A repository can be supplied as an argument in any of the following formats:
  - "OWNER/REPO"
  - by URL, e.g. "https://github.com/OWNER/REPO"

EXAMPLES
  $ gh repo create
  $ gh repo clone cli/cli
  $ gh repo view --web

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`

➜  workspace gh repo list
➜  workspace (repo list worked, output hidden here)
zsh: command not found: repo
➜  workspace aichat
zsh: command not found: aichat
➜  workspace 


Fix the above by 1) removing made-up commands 2) providing auth token to the copilot CLI

