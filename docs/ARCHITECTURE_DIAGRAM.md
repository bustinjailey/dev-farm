# Dev Farm Architecture Diagrams

## Current vs New Architecture

### Current Architecture (Before Changes)

```mermaid
graph TD
    A[Container Start] --> B[startup.sh]
    B --> C{DEV_MODE?}
    
    C -->|ssh| D[Mount to /home/coder/workspace/remote]
    C -->|git| E[Clone to /home/coder/workspace/repo]
    C -->|workspace| F[Use /home/coder/workspace]
    
    D --> G[VS Code opens /home/coder/workspace]
    E --> G
    F --> G
    
    G --> H[User navigates to subdirectory]
    H -->|ssh| I[cd remote/]
    H -->|git| J[cd repo/]
    
    style D fill:#ffcccc
    style E fill:#ffcccc
    style H fill:#ffcccc
    style I fill:#ffcccc
    style J fill:#ffcccc
```

### New Architecture (After Changes)

```mermaid
graph TD
    A[Container Start] --> B[startup.sh]
    B --> B1[Install/Update Aggregate MCP]
    B1 --> C{DEV_MODE?}
    
    C -->|ssh| D[Mount to /home/coder/remote]
    C -->|git| E[Clone to /home/coder/repo]
    C -->|workspace| F[Use /home/coder/workspace]
    
    D --> G[VS Code opens /home/coder/remote]
    E --> H[VS Code opens /home/coder/repo]
    F --> I[VS Code opens /home/coder/workspace]
    
    G --> J[Direct access to files]
    H --> J
    I --> J
    
    style D fill:#ccffcc
    style E fill:#ccffcc
    style F fill:#ccffcc
    style G fill:#ccffcc
    style H fill:#ccffcc
    style I fill:#ccffcc
```

## MCP Server Architecture

### Current MCP Setup

```mermaid
graph LR
    A[AI Extensions] --> B[Cline]
    A --> C[GitHub Copilot]
    
    B --> D[filesystem MCP]
    B --> E[github MCP]
    B --> F[brave-search MCP]
    
    C --> G[filesystem MCP]
    C --> H[github MCP]
    C --> I[brave-search MCP]
    
    D --> J[/workspace]
    G --> J
    
    style D fill:#lightblue
    style E fill:#lightblue
    style F fill:#lightblue
    style G fill:#lightblue
    style H fill:#lightblue
    style I fill:#lightblue
```

### New MCP Setup with Aggregate Server

```mermaid
graph LR
    A[AI Extensions] --> B[Cline]
    A --> C[GitHub Copilot]
    
    B --> D[Aggregate MCP Server]
    C --> E[Aggregate MCP Server]
    
    D --> F[filesystem MCP]
    D --> G[github MCP]
    D --> H[brave-search MCP]
    D --> I[...other MCPs]
    
    E --> F
    E --> G
    E --> H
    E --> I
    
    F --> J[Mode-specific workspace]
    
    K[Auto-Update Service] -.->|git pull on startup| D
    
    style D fill:#90EE90
    style E fill:#90EE90
    style K fill:#FFD700
```

## Workspace Root by Mode

```mermaid
graph TD
    A[Dev Farm Environment] --> B{Mode Selection}
    
    B -->|SSH Mode| C[/home/coder/remote]
    B -->|Git Mode| D[/home/coder/repo]
    B -->|Workspace Mode| E[/home/coder/workspace]
    
    C --> F[SSHFS Mount Point]
    C --> G[Remote filesystem visible at root]
    
    D --> H[Git Clone Root]
    D --> I[Repository files at root]
    
    E --> J[Local Workspace]
    E --> K[User files at root]
    
    F --> L[VS Code Workspace Root = /home/coder/remote]
    G --> L
    
    H --> M[VS Code Workspace Root = /home/coder/repo]
    I --> M
    
    J --> N[VS Code Workspace Root = /home/coder/workspace]
    K --> N
    
    style C fill:#FFE4B5
    style D fill:#E0BBE4
    style E fill:#B5E4FF
    style L fill:#FFE4B5
    style M fill:#E0BBE4
    style N fill:#B5E4FF
```

## Settings Configuration Flow

```mermaid
graph TD
    A[Container Startup] --> B[Apply Machine-Level Settings]
    B --> C[~/.vscode-server-insiders/data/Machine/settings.json]
    
    C --> D[Security Settings]
    C --> E[Theme & Editor Config]
    C --> F[AI Extension Defaults]
    
    F --> G[github.copilot.chat.model = claude-sonnet-4.5]
    F --> H[cline.anthropicModel = claude-sonnet-4-20250514]
    F --> I[kilocode.defaultModel = claude-sonnet-4.5]
    
    C --> J[User Opens Workspace]
    J --> K{Workspace .vscode/settings.json exists?}
    
    K -->|Yes| L[Apply Workspace Overrides]
    K -->|No| M[Use Machine Settings Only]
    
    L --> N[Final Configuration]
    M --> N
    
    style C fill:#90EE90
    style F fill:#FFD700
    style N fill:#87CEEB
```

## Aggregate MCP Server Update Flow

```mermaid
sequenceDiagram
    participant S as startup.sh
    participant G as GitHub
    participant L as Local Install
    participant M as MCP Server
    
    S->>L: Check if MCP installed
    
    alt MCP exists
        L->>G: git fetch origin main
        G-->>L: Latest commit hash
        L->>L: Compare with local hash
        
        alt Update available
            L->>G: git pull origin main
            G-->>L: Updated code
            L->>L: npm install
            L->>S: ✓ Updated successfully
        else Already up-to-date
            L->>S: ✓ Already up-to-date
        end
    else MCP not installed
        S->>G: git clone repo
        G-->>L: Clone complete
        L->>L: npm install
        L->>S: ✓ Installed successfully
    end
    
    S->>M: Start VS Code Server
    M->>M: Load MCP configuration
    M->>M: Connect to Aggregate MCP
```

## Complete Startup Flow

```mermaid
flowchart TD
    Start([Container Start]) --> PrepWorkspace[Prepare Workspace Directory]
    PrepWorkspace --> ConfigMCP[Configure MCP Servers]
    
    ConfigMCP --> CheckGH{GITHUB_TOKEN available?}
    CheckGH -->|Yes| InstallMCP[Install/Update Aggregate MCP]
    CheckGH -->|No| SkipMCP[Skip Aggregate MCP]
    
    InstallMCP --> CheckMode{Check DEV_MODE}
    SkipMCP --> CheckMode
    
    CheckMode -->|ssh| SSHMode[Setup SSH Mount]
    CheckMode -->|git| GitMode[Setup Git Clone]
    CheckMode -->|workspace| WorkspaceMode[Setup Workspace]
    
    SSHMode --> SetRoot1[WORKSPACE_ROOT=/home/coder/remote]
    GitMode --> SetRoot2[WORKSPACE_ROOT=/home/coder/repo]
    WorkspaceMode --> SetRoot3[WORKSPACE_ROOT=/home/coder/workspace]
    
    SetRoot1 --> ApplySettings[Apply Machine-Level Settings]
    SetRoot2 --> ApplySettings
    SetRoot3 --> ApplySettings
    
    ApplySettings --> InstallExt[Install Extensions]
    InstallExt --> CreateWelcome[Create Welcome File]
    CreateWelcome --> StartVSCode[Start VS Code Server]
    
    StartVSCode --> Ready([Environment Ready])
    
    style InstallMCP fill:#90EE90
    style SetRoot1 fill:#FFE4B5
    style SetRoot2 fill:#E0BBE4
    style SetRoot3 fill:#B5E4FF
    style Ready fill:#FFD700
```

## Benefits Summary

### Workspace Root Changes
- **Before**: Navigate through `/workspace/remote/` or `/workspace/repo/`
- **After**: Direct access at workspace root
- **Benefit**: Cleaner, more intuitive file navigation

### Aggregate MCP Server
- **Before**: Each AI tool manages separate MCP servers
- **After**: Single aggregate server proxies to all MCPs
- **Benefit**: Centralized management, auto-updates, easier configuration

### Settings Management
- **Before**: Workspace-level settings required for each workspace
- **After**: Machine-level settings with optional workspace overrides
- **Benefit**: Consistent configuration across all workspaces