#!/usr/bin/env python3
"""
Dev Farm Dashboard - Mobile-friendly web interface for managing development environments
"""

from flask import Flask, render_template, jsonify, request, redirect, url_for, session, Response, stream_with_context, send_from_directory
import docker
import os
import json
import subprocess
from datetime import datetime
import secrets
import re
import time
import requests
import threading
from threading import RLock
import queue
import functools

# Import gevent for spawning greenlets under gunicorn's gevent workers
try:
    from gevent import spawn as gevent_spawn
    USING_GEVENT = True
except ImportError:
    USING_GEVENT = False
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-farm-secret-key')

# Create static directory if it doesn't exist
STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')
os.makedirs(STATIC_DIR, exist_ok=True)

# Docker client
try:
    client = docker.from_env()
except Exception as e:
    print(f"Warning: Could not connect to Docker: {e}")
    client = None

REGISTRY_FILE = '/data/environments.json'
PATH_ALIAS_CONFIG = os.environ.get('DEVFARM_ALIAS_CONFIG', '/home/coder/.devfarm/path-aliases.json')
BASE_PORT = 8100
GITHUB_TOKEN_FILE = '/data/.github_token'
DEVICE_CODE_FILE = '/data/.device_code.json'
REPO_PATH = os.environ.get('HOST_REPO_PATH', '/opt/dev-farm')
FARM_CONFIG_FILE = os.path.join(REPO_PATH, 'farm.config')
EXTERNAL_URL = os.environ.get('EXTERNAL_URL', 'http://localhost:5000')

# Server-Sent Events support
SSE_CLIENTS = []
SSE_LOCK = threading.Lock()

def broadcast_sse(event_type, data):
    """Broadcast an SSE message to all connected clients"""
    with SSE_LOCK:
        dead_clients = []
        for client_queue in SSE_CLIENTS:
            try:
                client_queue.put({'event': event_type, 'data': data}, block=False)
            except queue.Full:
                dead_clients.append(client_queue)
        # Clean up disconnected clients
        for dead in dead_clients:
            SSE_CLIENTS.remove(dead)

# In-memory system update progress (polled by UI)
UPDATE_PROGRESS = {
    'running': False,
    'success': None,
    'stages': [],
    'error': None
}
UPDATE_LOCK = RLock()

# Track last known status of containers for change detection
LAST_KNOWN_STATUS = {}
STATUS_LOCK = threading.Lock()

def _reset_update_progress():
    with UPDATE_LOCK:
        UPDATE_PROGRESS.clear()
        UPDATE_PROGRESS.update({
            'running': True,
            'success': None,
            'stages': [],
            'error': None,
            'stage': 'idle',
            'status': 'idle'
        })

def _append_stage(stage, status, message=None):
    with UPDATE_LOCK:
        UPDATE_PROGRESS['stages'].append({
            'stage': stage,
            'status': status,
            'message': message
        })
        # Store latest stage/status at top level for easy access
        UPDATE_PROGRESS['stage'] = stage
        UPDATE_PROGRESS['status'] = status
        # Force flush to ensure stages are immediately available
        # This helps polling clients see updates without delay
    # Broadcast SSE event for real-time updates (outside lock to prevent deadlock)
    broadcast_sse('update-progress', {
        'stage': stage,
        'status': status,
        'message': message,
        'total_stages': len(UPDATE_PROGRESS['stages'])
    })

def _set_update_result(success, error=None):
    with UPDATE_LOCK:
        UPDATE_PROGRESS['success'] = success
        UPDATE_PROGRESS['error'] = error
        UPDATE_PROGRESS['running'] = False

def kebabify(name):
    """Convert any name to kebab-case (Docker-safe ID format)
    Examples: 'My Cool Project' -> 'my-cool-project'
              'Test_Env 123' -> 'test-env-123'
    """
    # Convert to lowercase
    name = name.lower()
    # Replace any non-alphanumeric character with hyphen
    name = re.sub(r'[^a-z0-9]+', '-', name)
    # Remove leading/trailing hyphens
    name = name.strip('-')
    # Collapse multiple hyphens
    name = re.sub(r'-+', '-', name)
    return name

def load_registry():
    """Load the registry of dev environments"""
    if os.path.exists(REGISTRY_FILE):
        with open(REGISTRY_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_registry(registry):
    """Save the registry of dev environments and broadcast update"""
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    with open(REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2)
    # Broadcast registry change to all connected clients
    broadcast_sse('registry-update', {'timestamp': time.time()})

@functools.lru_cache(maxsize=1)
def load_path_aliases():
    """Load sanitized path aliases produced by startup.sh."""
    try:
        with open(PATH_ALIAS_CONFIG, 'r', encoding='utf-8') as alias_file:
            data = json.load(alias_file)
            if isinstance(data, dict):
                return {str(key): str(value) for key, value in data.items() if isinstance(value, str)}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        print(f"[Paths] Failed to load {PATH_ALIAS_CONFIG}: {exc}")
    return {}


def get_workspace_path(mode):
    """Get the container workspace path based on environment mode.
    
    Note: SSH mode now uses /workspace as the initial path since we use
    VS Code Remote-SSH instead of SSHFS mounting. Users will connect to
    the remote host using the Remote-SSH extension.
    """
    alias_lookup = {
        'git': ('repo', '/repo'),
        'workspace': ('workspace', '/workspace'),
        'ssh': ('workspace', '/workspace'),  # Changed: SSH mode uses workspace, not remote mount
        'terminal': ('workspace', '/workspace')
    }
    alias_key, default_path = alias_lookup.get(mode, ('workspace', '/workspace'))
    alias_map = load_path_aliases()
    return alias_map.get(alias_key, default_path)

def load_farm_config():
    """Load farm configuration from JSON file"""
    if os.path.exists(FARM_CONFIG_FILE):
        try:
            with open(FARM_CONFIG_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"[Config] Error loading farm.config: {e}")
    return {}

def save_farm_config(config):
    """Save farm configuration to JSON file"""
    try:
        os.makedirs(os.path.dirname(FARM_CONFIG_FILE), exist_ok=True)
        with open(FARM_CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        os.chmod(FARM_CONFIG_FILE, 0o600)
        print(f"[Config] Saved farm.config")
        return True
    except Exception as e:
        print(f"[Config] Error saving farm.config: {e}")
        return False

def load_github_token():
    """Load GitHub token from multiple sources (priority order)"""
    # 1. farm.config (highest priority - user-editable PAT)
    config = load_farm_config()
    pat = config.get('github', {}).get('personal_access_token', '').strip()
    if pat:
        return pat
    
    # 2. OAuth token file (from device flow)
    if os.path.exists(GITHUB_TOKEN_FILE):
        try:
            with open(GITHUB_TOKEN_FILE, 'r') as f:
                token = f.read().strip()
                if token:
                    return token
        except:
            pass
    
    # 3. Environment variable (lowest priority, ignore empty strings)
    env_token = os.environ.get('GITHUB_TOKEN', '').strip()
    return env_token if env_token else None

def save_github_token(token):
    """Save GitHub token to shared storage and update environment"""
    os.makedirs(os.path.dirname(GITHUB_TOKEN_FILE), exist_ok=True)
    with open(GITHUB_TOKEN_FILE, 'w') as f:
        f.write(token)
    os.chmod(GITHUB_TOKEN_FILE, 0o600)
    # Update environment for current process
    os.environ['GITHUB_TOKEN'] = token

def sync_registry_with_containers():
    """Remove registry entries for containers that no longer exist or update their status"""
    if not client:
        return
    
    registry = load_registry()
    existing_containers = {}
    
    try:
        # Get all dev-farm containers
        containers = client.containers.list(all=True, filters={'label': 'dev-farm=true'})
        for c in containers:
            existing_containers[c.id] = c.status
    except Exception:
        return  # If Docker isn't available, don't modify registry
    
    # Remove registry entries for missing containers and update status
    registry_modified = False
    for env_name in list(registry.keys()):
        container_id = registry[env_name].get('container_id')
        if container_id:
            if container_id not in existing_containers:
                # Container was deleted - remove from registry
                del registry[env_name]
                registry_modified = True
            elif registry[env_name].get('status') != existing_containers[container_id]:
                # Status changed - update registry
                registry[env_name]['status'] = existing_containers[container_id]
                registry_modified = True
    
    if registry_modified:
        save_registry(registry)

def prune_dangling_images():
    """Remove dangling (untagged) images after updates to free space"""
    if not client:
        return
    
    try:
        # Remove dangling images (old versions after rebuild)
        pruned = client.images.prune(filters={'dangling': True})
        space_reclaimed = pruned.get('SpaceReclaimed', 0)
        if space_reclaimed > 0:
            print(f"Pruned dangling images, reclaimed {space_reclaimed / (1024*1024):.1f} MB")
    except Exception as e:
        print(f"Error pruning dangling images: {e}")

def get_next_port():
    """Get the next available port"""
    registry = load_registry()
    used_ports = [env['port'] for env in registry.values()]
    port = BASE_PORT
    while port in used_ports:
        port += 1
    return port

def get_container_stats(container):
    """Get stats for a container"""
    try:
        stats = container.stats(stream=False)
        
        # CPU usage
        cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - \
                   stats['precpu_stats']['cpu_usage']['total_usage']
        system_delta = stats['cpu_stats']['system_cpu_usage'] - \
                      stats['precpu_stats']['system_cpu_usage']
        cpu_percent = (cpu_delta / system_delta) * 100.0 if system_delta > 0 else 0
        
        # Memory usage
        mem_usage = stats['memory_stats'].get('usage', 0)
        mem_limit = stats['memory_stats'].get('limit', 1)
        mem_percent = (mem_usage / mem_limit) * 100.0 if mem_limit > 0 else 0
        
        return {
            'cpu': round(cpu_percent, 1),
            'memory': round(mem_percent, 1),
            'memory_mb': round(mem_usage / 1024 / 1024, 1)
        }
    except Exception as e:
        return {'cpu': 0, 'memory': 0, 'memory_mb': 0}

def is_env_ready(container_name, port=None):
    """Check if environment container is ready via Docker health check.
    In tunnel mode, VS Code doesn't expose local HTTP ports.
    Health check verifies the tunnel process is running.
    """
    try:
        # Check Docker healthcheck status (verifies tunnel process is running)
        if client:
            try:
                container = client.containers.get(container_name)
                health = container.attrs.get('State', {}).get('Health', {})
                if health:
                    health_status = health.get('Status', '')
                    # If healthcheck exists and reports healthy, container is ready
                    if health_status == 'healthy':
                        return True
                    # If unhealthy or starting, definitely not ready
                    elif health_status in ['unhealthy', 'starting']:
                        return False
            except Exception:
                pass
        
        # Last resort: Try via mapped port if provided
        if port:
            try:
                resp = requests.get(f'http://localhost:{port}', timeout=1.5)
                return 200 <= resp.status_code < 400
            except Exception:
                pass
        
        return False
    except Exception:
        return False

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files (favicon, etc.)"""
    return send_from_directory(STATIC_DIR, filename)

@app.route('/favicon.ico')
def favicon():
    """Serve favicon.ico (redirect to SVG for modern browsers)"""
    return send_from_directory(STATIC_DIR, 'favicon.svg', mimetype='image/svg+xml')

@app.route('/')
def index():
    """Main dashboard page"""
    sync_registry_with_containers()  # Clean up stale registry entries
    registry = load_registry()
    environments = []
    
    if client:
        for env_id, env_data in registry.items():
            try:
                container = client.containers.get(env_data['container_id'])
                status = container.status
                stats = get_container_stats(container) if status == 'running' else {}
                # Determine readiness: even if Docker says running, code-server may still be starting
                ready = is_env_ready(container.name, env_data['port']) if status == 'running' else False
                display_status = 'running' if ready else ('starting' if status == 'running' else status)
                
                mode = env_data.get('mode', 'workspace')
                workspace_path = get_workspace_path(mode)
                
                # Generate path-based URL using EXTERNAL_URL
                base_url = EXTERNAL_URL.rstrip('/')
                env_url = f"{base_url}/env/{env_id}?folder={workspace_path}"
                
                environments.append({
                    'name': env_data.get('display_name', env_id),  # Use display_name if available
                    'id': env_id,
                    'port': env_data['port'],
                    'status': display_status,
                    'created': env_data.get('created', 'Unknown'),
                    'project': env_data.get('project', 'general'),
                    'mode': mode,
                    'ssh_host': env_data.get('ssh_host'),
                    'git_url': env_data.get('git_url'),
                    'stats': stats,
                    'ready': ready,
                    'url': env_url
                })
            except docker.errors.NotFound:
                # Container no longer exists
                pass
    
    return render_template('index.html', 
                         environments=environments,
                         external_url=EXTERNAL_URL)

@app.route('/api/stream')
def stream():
    """Server-Sent Events endpoint for real-time updates"""
    def event_stream():
        client_queue = queue.Queue(maxsize=10)
        with SSE_LOCK:
            SSE_CLIENTS.append(client_queue)
        
        try:
            # Send initial connection success
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            
            while True:
                try:
                    # Get message from queue with timeout (longer for better stability)
                    message = client_queue.get(timeout=45)
                    event_type = message.get('event', 'message')
                    data = message.get('data', {})
                    yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                except queue.Empty:
                    # Send heartbeat to keep connection alive (every 45 seconds)
                    yield f": heartbeat {datetime.now().isoformat()}\n\n"
        except GeneratorExit:
            # Client disconnected
            with SSE_LOCK:
                if client_queue in SSE_CLIENTS:
                    SSE_CLIENTS.remove(client_queue)
    
    return Response(
        stream_with_context(event_stream()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

@app.route('/api/environments')
def api_environments():
    """API endpoint for environment list"""
    registry = load_registry()
    environments = []
    
    if client:
        for env_id, env_data in registry.items():
            try:
                container = client.containers.get(env_data['container_id'])
                status = container.status
                ready = is_env_ready(container.name, env_data.get('port')) if status == 'running' else False
                display_status = 'running' if ready else ('starting' if status == 'running' else status)
                mode = env_data.get('mode', 'workspace')
                workspace_path = get_workspace_path(mode)
                
                # Generate vscode.dev tunnel URL
                tunnel_name = f"devfarm-{env_id}"
                env_url = f"https://vscode.dev/tunnel/{tunnel_name}/{workspace_path}"
                
                environments.append({
                    'name': env_data.get('display_name', env_id),
                    'id': env_id,
                    'port': env_data['port'],
                    'status': display_status,
                    'ready': ready,
                    'url': env_url
                })
            except docker.errors.NotFound:
                pass
    
    return jsonify(environments)

@app.route('/create', methods=['POST'])
def create_environment():
    """Create a new development environment"""
    data = request.get_json()
    display_name = data.get('name', f'env-{datetime.now().strftime("%Y%m%d-%H%M%S")}')
    
    # Kebabify the name for Docker container/volume IDs
    env_id = kebabify(display_name)
    
    project = data.get('project', 'general')
    mode = data.get('mode', 'workspace')  # workspace, ssh, git, or terminal
    connection_mode = data.get('connection_mode', 'web')  # web or tunnel
    
    # Mode-specific parameters
    ssh_host = data.get('ssh_host', '')
    ssh_user = data.get('ssh_user', '')
    ssh_path = data.get('ssh_path', '/home')
    ssh_password = data.get('ssh_password', '')  # Optional password for SSH authentication
    git_url = data.get('git_url', '')
    
    # Convert SSH URLs to HTTPS for credential helper compatibility
    if git_url.startswith('git@github.com:'):
        # Convert git@github.com:user/repo.git to https://github.com/user/repo.git
        git_url = git_url.replace('git@github.com:', 'https://github.com/')
        print(f"Converted SSH URL to HTTPS: {git_url}")
    
    # Parent-child tracking parameters
    parent_env_id = data.get('parent_env_id')
    creator_type = data.get('creator_type', 'user')  # 'user' or 'ai'
    creator_name = data.get('creator_name', 'Unknown')
    creator_env_id = data.get('creator_env_id')
    creation_source = data.get('creation_source', 'dashboard')
    
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    sync_registry_with_containers()  # Clean up stale registry entries before checking
    registry = load_registry()
    
    # Check if environment ID already exists
    if env_id in registry:
        return jsonify({'error': f'Environment "{display_name}" (ID: {env_id}) already exists'}), 400
    
    port = get_next_port()
    
    try:
        # Get GitHub configuration from farm.config
        github_token = load_github_token()
        config = load_farm_config()
        github_config = config.get('github', {})
        # Default to 'bustinjailey' for backward compatibility with existing deployments
        # Users should set their own username in farm.config
        github_username = github_config.get('username', 'bustinjailey')
        github_email = github_config.get('email', f'{github_username}@users.noreply.github.com')
        
        # Validate token has required scopes for git mode with private repos
        if mode == 'git' and github_token and git_url:
            # Check if URL is a private repo (assume all git@ or https://github.com/bustinjailey/ URLs are private)
            is_private_repo = 'bustinjailey' in git_url.lower()
            
            if is_private_repo:
                try:
                    scope_check = requests.get(
                        'https://api.github.com/user',
                        headers={'Authorization': f'token {github_token}'},
                        timeout=5
                    )
                    if scope_check.status_code == 200:
                        scopes = scope_check.headers.get('X-OAuth-Scopes', '')
                        if 'repo' not in scopes:
                            return jsonify({
                                'error': 'GitHub token lacks required scopes for private repositories',
                                'needs_reauth': True,
                                'message': 'Your GitHub token does not have access to private repositories. Please disconnect and reconnect your GitHub account to grant the necessary permissions.'
                            }), 403
                    elif scope_check.status_code == 401:
                        return jsonify({
                            'error': 'GitHub token is invalid or expired',
                            'needs_reauth': True,
                            'message': 'Your GitHub token has expired. Please reconnect your GitHub account.'
                        }), 401
                except Exception as e:
                    print(f"Scope validation error: {str(e)}")
        
        if not github_token:
            print("Warning: GITHUB_TOKEN not set. Environments will not have GitHub authentication.")
        
        # Create container with environment variables
        # Note: Tunnel mode doesn't use port mapping, but we track port numbers for registry consistency
        print(f"Creating container {env_id} ('{display_name}') - tunnel mode (no port mapping)")
        
        # Build environment variables
        env_vars = {
            'GITHUB_TOKEN': github_token,
            'GITHUB_USERNAME': github_username,
            'GITHUB_EMAIL': github_email,
            'DEV_MODE': mode,
            'CONNECTION_MODE': connection_mode,  # web or tunnel
            'WORKSPACE_NAME': display_name,  # Pass display name for workspace tab
            'DEVFARM_ENV_ID': env_id,  # Pass environment ID for MCP server tracking
            'ENV_NAME': env_id  # Pass environment name for URL base path
        }
        
        # Add API keys from farm.config (MCP server configuration)
        config = load_farm_config()
        mcp_config = config.get('mcp', {})
        api_keys = mcp_config.get('api_keys', {})
        if api_keys.get('brave_search'):
            env_vars['BRAVE_API_KEY'] = api_keys['brave_search']
            print(f"[Config] Added BRAVE_API_KEY from farm.config")
        
        # Add mode-specific environment variables
        if mode == 'ssh':
            env_vars['SSH_HOST'] = ssh_host
            env_vars['SSH_USER'] = ssh_user
            env_vars['SSH_PATH'] = ssh_path
            if ssh_password:  # Only add password if provided
                env_vars['SSH_PASSWORD'] = ssh_password
        elif mode == 'git':
            env_vars['GIT_URL'] = git_url
        
        # Container run options - use terminal image for terminal mode
        image_name = 'dev-farm/terminal:latest' if mode == 'terminal' else 'dev-farm/code-server:latest'
        
        # Ensure terminal image exists before trying to use it
        if mode == 'terminal':
            try:
                client.images.get(image_name)
            except docker.errors.ImageNotFound:
                # Build the terminal image if it doesn't exist
                print(f"Terminal image not found, building {image_name}...")
                try:
                    # Use docker-compose to build the image
                    build_result = subprocess.run(
                        ['docker', 'compose', '-f', f'{REPO_PATH}/docker-compose.yml', 'build', 'terminal-builder'],
                        capture_output=True,
                        text=True,
                        timeout=300
                    )
                    if build_result.returncode != 0:
                        raise Exception(f"Failed to build terminal image: {build_result.stderr}")
                    print(f"Terminal image built successfully")
                except Exception as e:
                    return jsonify({'error': f'Terminal image build failed: {str(e)}'}), 500
        
        run_kwargs = {
            'image': image_name,
            'name': f"devfarm-{env_id}",
            'detach': True,
            # Tunnel mode doesn't require port mapping - VS Code makes outbound connections
            'environment': env_vars,
            'network': 'devfarm',  # Connect to devfarm network for inter-container communication
            'dns': ['8.8.8.8', '8.8.4.4'],  # Use Google DNS to avoid DNS resolution issues
            'labels': {
                'dev-farm': 'true',
                'dev-farm.id': env_id,
                'dev-farm.name': display_name,
                'dev-farm.project': project,
                'dev-farm.mode': mode
            }
        }
        
        # For workspace and git modes, create a local volume
        # For ssh mode, we'll use SSHFS to mount remote storage instead
        # For terminal mode, create a volume for persistent workspace
        if mode in ['workspace', 'git', 'terminal']:
            run_kwargs['volumes'] = {
                f'devfarm-{env_id}': {'bind': '/home/coder/workspace', 'mode': 'rw'}
            }

        # SSH mode no longer requires privileged mode
        # We now use VS Code Remote-SSH instead of SSHFS mounting
        # This is more reliable and doesn't require FUSE or special permissions

        # Ensure no stale container exists with this name
        # This prevents reusing old container images after updates
        container_name = f"devfarm-{env_id}"
        try:
            existing = client.containers.get(container_name)
            print(f"Found existing container {container_name}, removing...")
            existing.stop(timeout=5)
            existing.remove(force=True)
            print(f"Removed stale container {container_name}")
        except docker.errors.NotFound:
            pass  # No existing container, proceed
        except Exception as e:
            print(f"Error removing stale container: {e}")

        # Verify the image exists locally before creating container
        # This ensures we use the latest built image, not a cached version
        try:
            client.images.get(image_name)
            print(f"Using local image: {image_name}")
        except docker.errors.ImageNotFound:
            return jsonify({'error': f'Image {image_name} not found. Please rebuild images.'}), 500

        container = client.containers.run(**run_kwargs)
        
        # Register environment with both display name and ID, plus parent-child tracking
        registry[env_id] = {
            'name': display_name,  # For template compatibility
            'display_name': display_name,
            'env_id': env_id,
            'container_id': container.id,
            'port': port,
            'created': datetime.now().isoformat(),
            'project': project,
            'mode': mode,
            'ssh_host': ssh_host if mode == 'ssh' else None,
            'ssh_password': ssh_password if mode == 'ssh' and ssh_password else None,  # Store password if provided
            'git_url': git_url if mode == 'git' else None,
            # Parent-child tracking
            'parent_env_id': parent_env_id,
            'creator_type': creator_type,
            'creator_name': creator_name,
            'creator_env_id': creator_env_id,
            'creation_source': creation_source,
            'children': []
        }
        
        # Update parent's children list
        if parent_env_id and parent_env_id in registry:
            if 'children' not in registry[parent_env_id]:
                registry[parent_env_id]['children'] = []
            registry[parent_env_id]['children'].append(env_id)
        
        save_registry(registry)
        
        workspace_path = get_workspace_path(mode)
        
        # Generate vscode.dev tunnel URL (tunnel mode doesn't use nginx proxy)
        tunnel_name = f"devfarm-{env_id}"
        env_url = f"https://vscode.dev/tunnel/{tunnel_name}/{workspace_path}"
        
        return jsonify({
            'success': True,
            'env_id': env_id,
            'display_name': display_name,
            'port': port,
            'url': env_url,
            'tunnel_name': tunnel_name,
            'mode': mode,
            'project': project
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/delete/<env_name>', methods=['POST'])
def delete_environment(env_name):
    """Delete a development environment"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    registry = load_registry()
    
    if env_name not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    try:
        container_name = f"devfarm-{env_name}"
        
        # Try to stop and remove by container ID first
        try:
            container = client.containers.get(registry[env_name]['container_id'])
            container.stop(timeout=10)
            container.remove(force=True)
        except Exception:
            pass  # Container might already be gone
        
        # Force remove any container with this name (handles stale containers)
        try:
            stale_container = client.containers.get(container_name)
            stale_container.stop(timeout=5)
            stale_container.remove(force=True)
        except Exception:
            pass  # No stale container found
        
        # Remove associated volume
        try:
            volume = client.volumes.get(f'devfarm-{env_name}')
            volume.remove(force=True)
        except Exception:
            pass  # Volume might not exist or already removed
        
        # Remove from registry
        del registry[env_name]
        save_registry(registry)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/start/<env_name>', methods=['POST'])
def start_environment(env_name):
    """Start a stopped environment"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    registry = load_registry()
    
    if env_name not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    try:
        container = client.containers.get(registry[env_name]['container_id'])
        container.start()
        broadcast_sse('env-status', {'env_id': env_name, 'status': 'starting'})
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/stop/<env_name>', methods=['POST'])
def stop_environment(env_name):
    """Stop a running environment"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    registry = load_registry()
    
    if env_name not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    try:
        container = client.containers.get(registry[env_name]['container_id'])
        container.stop()
        broadcast_sse('env-status', {'env_id': env_name, 'status': 'exited'})
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/environments/<env_id>/restart', methods=['POST'])
def restart_environment(env_id):
    """Restart an environment (stop and start)"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    registry = load_registry()
    
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    try:
        container = client.containers.get(registry[env_id]['container_id'])
        container.restart()
        broadcast_sse('env-status', {'env_id': env_id, 'status': 'restarting'})
        return jsonify({'success': True, 'message': f'Environment {env_id} restarted'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/environments/<env_id>/status')
def get_environment_status(env_id):
    """Get detailed status of a specific environment"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    registry = load_registry()
    
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    try:
        env_data = registry[env_id]
        container = client.containers.get(env_data['container_id'])
        status = container.status
        stats = get_container_stats(container) if status == 'running' else {}
        ready = is_env_ready(container.name, env_data.get('port')) if status == 'running' else False
        
        return jsonify({
            'status': 'running' if ready else ('starting' if status == 'running' else status),
            'ready': ready,
            'stats': stats,
            'env_data': env_data
        })
    except docker.errors.NotFound:
        return jsonify({'error': 'Container not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/images')
def list_images():
    """List available Docker images"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    try:
        # Get dev-farm images
        images = client.images.list(name='dev-farm')
        
        image_list = []
        for image in images:
            for tag in (image.tags or ['<none>']):
                image_list.append({
                    'name': tag.split(':')[0] if ':' in tag else tag,
                    'tag': tag.split(':')[1] if ':' in tag else 'latest',
                    'size': image.attrs.get('Size', 0),
                    'created': image.attrs.get('Created', '')
                })
        
        return jsonify({'images': image_list})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/images/build', methods=['POST'])
def build_image():
    """Trigger image rebuild"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    data = request.get_json()
    image_type = data.get('image_type', 'code-server')
    
    valid_types = ['code-server', 'terminal', 'dashboard']
    if image_type not in valid_types:
        return jsonify({'error': f'Invalid image type. Must be one of: {", ".join(valid_types)}'}), 400
    
    try:
        # Ensure updater container exists
        try:
            updater = client.containers.get('devfarm-updater')
            if updater.status != 'running':
                updater.start()
                time.sleep(1)
        except docker.errors.NotFound:
            updater = client.containers.run(
                'docker:27-cli',
                name='devfarm-updater',
                volumes={
                    '/var/run/docker.sock': {'bind': '/var/run/docker.sock', 'mode': 'rw'},
                    REPO_PATH: {'bind': REPO_PATH, 'mode': 'rw'}
                },
                command='tail -f /dev/null',
                detach=True,
                restart_policy={'Name': 'unless-stopped'},
                network_mode='bridge'
            )
            time.sleep(2)
        
        # Build the appropriate image
        if image_type == 'code-server':
            build_cmd = f'docker build --no-cache -t dev-farm/code-server:latest -f {REPO_PATH}/docker/Dockerfile.code-server {REPO_PATH}/docker'
        elif image_type == 'terminal':
            # Use docker-compose to build terminal image for consistency
            build_cmd = f'docker compose -f {REPO_PATH}/docker-compose.yml build --no-cache terminal-builder'
        else:  # dashboard
            build_cmd = f'docker build --no-cache -t dev-farm-dashboard:latest {REPO_PATH}/dashboard'
        
        exec_result = updater.exec_run(cmd=['sh', '-c', build_cmd], demux=False)
        
        if exec_result.exit_code == 0:
            return jsonify({'success': True, 'message': f'{image_type} image built successfully'})
        else:
            error_output = exec_result.output.decode('utf-8', errors='replace') if exec_result.output else 'unknown error'
            return jsonify({'success': False, 'message': f'Build failed: {error_output[-200:]}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/environments/hierarchy')
def get_environment_hierarchy():
    """Get environment hierarchy tree"""
    registry = load_registry()
    
    def build_tree(env_id):
        if env_id not in registry:
            return None
        env = registry[env_id]
        
        # Get status
        status = 'unknown'
        if client:
            try:
                container = client.containers.get(env.get('container_id'))
                status = container.status
            except:
                pass
        
        return {
            'id': env_id,
            'name': env.get('display_name', env_id),
            'creator': env.get('creator_name'),
            'creator_type': env.get('creator_type'),
            'status': status,
            'children': [build_tree(child) for child in env.get('children', []) if build_tree(child)]
        }
    
    # Get root environments (no parent)
    roots = [env_id for env_id, env in registry.items()
             if not env.get('parent_env_id')]
    
    trees = [build_tree(root) for root in roots]
    trees = [tree for tree in trees if tree]  # Filter out None values
    
    return jsonify({'trees': trees})

@app.route('/api/github/status')
def github_status():
    """Check GitHub authentication status and token scopes"""
    github_token = load_github_token()
    config = load_farm_config()
    using_pat = bool(config.get('github', {}).get('personal_access_token'))
    
    if not github_token:
        return jsonify({
            'authenticated': False,
            'message': 'No GitHub token found. Please connect your GitHub account or set a PAT.'
        })
    
    try:
        # Verify token and get scopes
        response = requests.get(
            'https://api.github.com/user',
            headers={
                'Authorization': f'token {github_token}',
                'Accept': 'application/json'
            },
            timeout=10
        )
        
        if response.status_code == 401:
            return jsonify({
                'authenticated': False,
                'message': 'Token is invalid or expired. Please reconnect your GitHub account.',
                'needs_reauth': True
            })
        
        if response.status_code != 200:
            return jsonify({
                'authenticated': False,
                'message': f'GitHub API error: {response.status_code}'
            })
        
        user_data = response.json()
        
        # Get token scopes from response headers
        scopes_header = response.headers.get('X-OAuth-Scopes', '')
        token_scopes = [s.strip() for s in scopes_header.split(',') if s.strip()]
        
        # Required scopes for private repo access
        required_scopes = {'repo'}  # 'repo' scope covers all repository access
        has_required_scopes = required_scopes.issubset(set(token_scopes))
        
        # Test private repo access
        test_response = requests.get(
            'https://api.github.com/repos/bustinjailey/aggregate-mcp-server',
            headers={'Authorization': f'token {github_token}'},
            timeout=10
        )
        can_access_private = test_response.status_code == 200
        
        return jsonify({
            'authenticated': True,
            'username': user_data.get('login'),
            'scopes': token_scopes,
            'has_required_scopes': has_required_scopes,
            'can_access_private_repos': can_access_private,
            'needs_reauth': not has_required_scopes or not can_access_private,
            'using_pat': using_pat,
            'message': 'Token valid but missing required scopes. Please set a PAT in farm.config or reconnect.' if not has_required_scopes else None
        })
    
    except Exception as e:
        return jsonify({
            'authenticated': False,
            'message': f'Error checking GitHub status: {str(e)}'
        }), 500

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'docker_connected': client is not None,
        'environments': len(load_registry())
    })

@app.route('/api/github/repos')
def github_repos():
    """Get GitHub repositories for the authenticated user"""
    github_token = load_github_token()
    if not github_token:
        return jsonify({'error': 'GitHub token not configured'}), 401
    
    try:
        import requests
        headers = {
            'Authorization': f'token {github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        
        # Quick token validation before making API calls
        scope_check = requests.get(
            'https://api.github.com/user',
            headers=headers,
            timeout=5
        )
        
        if scope_check.status_code == 401:
            return jsonify({
                'error': 'Token is invalid or expired',
                'needs_reauth': True,
                'message': 'Your GitHub token has expired. Please disconnect and reconnect your GitHub account.'
            }), 401
        
        # Get user's repositories (includes private repos with 'repo' scope)
        response = requests.get('https://api.github.com/user/repos', headers=headers, params={
            'sort': 'updated',
            'per_page': 100,
            'visibility': 'all',
            'affiliation': 'owner,collaborator,organization_member'
        })
        
        if response.status_code == 200:
            repos = response.json()
            # Log for debugging
            private_count = sum(1 for r in repos if r.get('private'))
            app.logger.info(f"Fetched {len(repos)} repos ({private_count} private, {len(repos) - private_count} public)")
            
            return jsonify([{
                'name': repo['full_name'],
                'ssh_url': repo['ssh_url'],
                'https_url': repo['clone_url'],
                'description': repo['description'],
                'private': repo['private'],
                'updated': repo['updated_at']
            } for repo in repos])
        else:
            app.logger.error(f"GitHub API error: {response.status_code} - {response.text}")
            return jsonify({'error': f'Failed to fetch repositories: {response.status_code}'}), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/github/disconnect', methods=['POST'])
def github_disconnect():
    """Disconnect GitHub by removing the stored token"""
    try:
        # Remove OAuth token file
        if os.path.exists(GITHUB_TOKEN_FILE):
            os.remove(GITHUB_TOKEN_FILE)
            print("[GitHub] OAuth token file removed")
        
        # Remove PAT from farm.config
        config = load_farm_config()
        if config.get('github', {}).get('personal_access_token'):
            if 'github' not in config:
                config['github'] = {}
            config['github']['personal_access_token'] = ''
            save_farm_config(config)
            print("[GitHub] PAT removed from farm.config")
        
        # Clear from environment
        if 'GITHUB_TOKEN' in os.environ:
            del os.environ['GITHUB_TOKEN']
            print("[GitHub] Token removed from environment")
        
        # Clean up any OAuth flow in progress
        if os.path.exists(DEVICE_CODE_FILE):
            os.remove(DEVICE_CODE_FILE)
            print("[GitHub] Device code file removed")
        
        return jsonify({
            'success': True,
            'message': 'GitHub account disconnected successfully. You can now reconnect with updated permissions.'
        })
    except Exception as e:
        return jsonify({
            'error': f'Failed to disconnect: {str(e)}'
        }), 500

@app.route('/api/config/github', methods=['GET', 'POST'])
def manage_github_config():
    """Get or update GitHub configuration in farm.config"""
    if request.method == 'GET':
        config = load_farm_config()
        github_config = config.get('github', {})
        # Don't expose the actual token, just whether it's set
        return jsonify({
            'has_pat': bool(github_config.get('personal_access_token')),
            'username': github_config.get('username', ''),
            'email': github_config.get('email', '')
        })
    
    elif request.method == 'POST':
        data = request.json
        config = load_farm_config()
        
        if 'github' not in config:
            config['github'] = {}
        
        # Update PAT if provided
        if 'personal_access_token' in data:
            pat = data['personal_access_token'].strip()
            if pat:
                # Validate token format
                if not (pat.startswith('ghp_') or pat.startswith('github_pat_')):
                    return jsonify({'error': 'Invalid token format. Must start with ghp_ or github_pat_'}), 400
                config['github']['personal_access_token'] = pat
            else:
                config['github']['personal_access_token'] = ''
        
        # Update username/email if provided
        if 'username' in data:
            config['github']['username'] = data['username'].strip()
        if 'email' in data:
            config['github']['email'] = data['email'].strip()
        
        if save_farm_config(config):
            return jsonify({'success': True, 'message': 'GitHub configuration updated'})
        else:
            return jsonify({'error': 'Failed to save configuration'}), 500

@app.route('/api/github/auth/start', methods=['POST'])
def github_auth_start():
    """Start GitHub OAuth device flow"""
    try:
        # Request device code from GitHub
        response = requests.post(
            'https://github.com/login/device/code',
            headers={'Accept': 'application/json'},
            data={'client_id': 'Iv1.b507a08c87ecfe98', 'scope': 'repo read:org gist workflow'}
        )
        
        if response.status_code == 200:
            data = response.json()
            # Save device code data for polling
            device_data = {
                'device_code': data['device_code'],
                'user_code': data['user_code'],
                'verification_uri': data['verification_uri'],
                'expires_in': data['expires_in'],
                'interval': data['interval'],
                'started_at': time.time()
            }
            with open(DEVICE_CODE_FILE, 'w') as f:
                json.dump(device_data, f)
            
            return jsonify({
                'user_code': data['user_code'],
                'verification_uri': data['verification_uri'],
                'expires_in': data['expires_in'],
                'interval': data.get('interval', 5)
            })
        else:
            return jsonify({'error': 'Failed to start OAuth flow'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/github/auth/poll', methods=['POST'])
def github_auth_poll():
    """Poll for OAuth device flow completion"""
    try:
        if not os.path.exists(DEVICE_CODE_FILE):
            print("[OAuth Poll] No device code file found")
            return jsonify({'status': 'no_flow', 'message': 'No OAuth flow in progress'})
        
        with open(DEVICE_CODE_FILE, 'r') as f:
            device_data = json.load(f)
        
        # Check if expired
        elapsed = time.time() - device_data['started_at']
        if elapsed > device_data['expires_in']:
            print(f"[OAuth Poll] Code expired (elapsed: {elapsed}s, expires_in: {device_data['expires_in']}s)")
            os.remove(DEVICE_CODE_FILE)
            return jsonify({'status': 'expired'})
        
        print(f"[OAuth Poll] Checking authorization status (elapsed: {elapsed:.1f}s)...")
        
        # Poll GitHub for token
        response = requests.post(
            'https://github.com/login/oauth/access_token',
            headers={'Accept': 'application/json'},
            data={
                'client_id': 'Iv1.b507a08c87ecfe98',
                'device_code': device_data['device_code'],
                'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'
            },
            timeout=10
        )
        
        print(f"[OAuth Poll] GitHub response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"[OAuth Poll] GitHub response: {result}")
            
            if 'access_token' in result:
                print("[OAuth Poll] ✅ Authorization successful!")
                # Success! Save token
                save_github_token(result['access_token'])
                os.remove(DEVICE_CODE_FILE)
                
                # Get user info
                user_response = requests.get(
                    'https://api.github.com/user',
                    headers={'Authorization': f'token {result["access_token"]}'}
                )
                
                if user_response.status_code == 200:
                    user_data = user_response.json()
                    print(f"[OAuth Poll] User: {user_data.get('login')}")
                    return jsonify({
                        'status': 'success',
                        'username': user_data.get('login')
                    })
                else:
                    print(f"[OAuth Poll] Failed to get user info: {user_response.status_code}")
                    return jsonify({'status': 'success'})
            
            elif result.get('error') == 'authorization_pending':
                print("[OAuth Poll] Still waiting for user authorization...")
                return jsonify({'status': 'pending'})
            
            elif result.get('error') == 'slow_down':
                print("[OAuth Poll] Rate limited - client should slow down")
                return jsonify({'status': 'slow_down', 'message': 'Polling too fast, increase interval by 5 seconds'})
            
            elif result.get('error') == 'expired_token':
                print("[OAuth Poll] Token expired")
                os.remove(DEVICE_CODE_FILE)
                return jsonify({'status': 'expired'})
            
            elif result.get('error') == 'access_denied':
                print("[OAuth Poll] User denied authorization")
                os.remove(DEVICE_CODE_FILE)
                return jsonify({'status': 'denied'})
            
            else:
                error_msg = result.get('error_description', result.get('error', 'Unknown error'))
                print(f"[OAuth Poll] ❌ Error: {error_msg}")
                return jsonify({'status': 'error', 'message': error_msg})
        
        print(f"[OAuth Poll] ❌ Unexpected status code: {response.status_code}")
        return jsonify({'status': 'error', 'message': f'HTTP {response.status_code}'}), 500
    except Exception as e:
        print(f"[OAuth Poll] ❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': str(e)}), 500



@app.route('/api/github/auth/logout', methods=['POST'])
def github_auth_logout():
    """Remove GitHub token"""
    try:
        if os.path.exists(GITHUB_TOKEN_FILE):
            os.remove(GITHUB_TOKEN_FILE)
            print("[GitHub Auth] Token removed")
        
        # Clear from environment
        if 'GITHUB_TOKEN' in os.environ:
            del os.environ['GITHUB_TOKEN']
        
        return jsonify({'success': True, 'message': 'Logged out successfully'})
    except Exception as e:
        print(f"[GitHub Auth] Error during logout: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/github/auth/status')
def github_auth_status():
    """Check GitHub authentication status"""
    github_token = load_github_token()
    if not github_token:
        return jsonify({'authenticated': False, 'message': 'No token configured'})
    
    try:
        import requests
        headers = {
            'Authorization': f'token {github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        response = requests.get('https://api.github.com/user', headers=headers)
        
        if response.status_code == 200:
            user_data = response.json()
            return jsonify({
                'authenticated': True,
                'username': user_data.get('login'),
                'name': user_data.get('name'),
                'avatar': user_data.get('avatar_url')
            })
        else:
            return jsonify({'authenticated': False, 'message': 'Invalid token'})
    except Exception as e:
        return jsonify({'authenticated': False, 'message': str(e)})

@app.route('/api/system/upgrade', methods=['POST'])
def system_upgrade():
    """Upgrade the dev-farm system"""
    try:
        # Run the upgrade script
        result = subprocess.run(
            ['/bin/bash', '/opt/scripts/upgrade.sh'],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        return jsonify({
            'success': result.returncode == 0,
            'output': result.stdout,
            'error': result.stderr if result.returncode != 0 else None
        })
    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Upgrade timed out'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/system/status')
def system_status():
    """Get system status information"""
    try:
        # Get current commit SHA
        current_sha = ''
        try:
            result = subprocess.run(
                ['git', 'rev-parse', '--short', 'HEAD'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH
            )
            if result.returncode == 0:
                current_sha = result.stdout.strip()
        except:
            pass
        
        # Check for updates
        updates_available = False
        commits_behind = 0
        latest_sha = ''
        try:
            # Fetch latest from remote
            subprocess.run(
                ['git', 'fetch', 'origin', 'main'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH
            )
            
            # Get remote SHA
            result = subprocess.run(
                ['git', 'rev-parse', '--short', 'origin/main'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH
            )
            if result.returncode == 0:
                latest_sha = result.stdout.strip()
                
            # Check if we're behind
            result = subprocess.run(
                ['git', 'rev-list', '--count', 'HEAD..origin/main'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH
            )
            if result.returncode == 0:
                commits_behind = int(result.stdout.strip())
                updates_available = commits_behind > 0
        except:
            pass
        
        return jsonify({
            'docker_connected': client is not None,
            'environments': len(load_registry()),
            'updates_available': updates_available,
            'commits_behind': commits_behind,
            'current_sha': current_sha,
            'latest_sha': latest_sha
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/system/orphans')
def get_orphans():
    """Detect orphaned containers (containers not in registry)"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    try:
        registry = load_registry()
        tracked_container_ids = {env['container_id'] for env in registry.values()}
        
        # Get all dev-farm containers
        containers = client.containers.list(all=True, filters={'label': 'dev-farm=true'})
        
        orphans = []
        for container in containers:
            if container.id not in tracked_container_ids:
                orphans.append({
                    'id': container.id[:12],
                    'name': container.name,
                    'status': container.status,
                    'created': container.attrs['Created'],
                    'ports': container.attrs['NetworkSettings']['Ports']
                })
        
        return jsonify({
            'count': len(orphans),
            'orphans': orphans
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/environments/<env_name>/logs')
def get_environment_logs(env_name):
    """Get container logs for an environment"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    registry = load_registry()
    
    if env_name not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    try:
        env_data = registry[env_name]
        container = client.containers.get(env_data['container_id'])
        logs = container.logs(tail=500, timestamps=True).decode('utf-8', errors='replace')
        
        # Determine actual status (account for readiness, not just Docker status)
        status = container.status
        if status == 'running':
            # Check if actually ready by probing the web UI
            ready = is_env_ready(container.name, env_data.get('port'))
            display_status = 'running' if ready else 'starting'
        else:
            display_status = status
        
        return jsonify({
            'success': True,
            'logs': logs,
            'status': display_status
        })
    except docker.errors.NotFound:
        # Container was deleted - sync registry
        sync_registry_with_containers()
        return jsonify({'error': 'Container not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/system/cleanup-orphans', methods=['POST'])
def cleanup_orphans():
    """Stop and remove orphaned containers"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    data = request.get_json()
    container_ids = data.get('container_ids', [])  # If empty, clean all orphans
    
    try:
        registry = load_registry()
        tracked_container_ids = {env['container_id'] for env in registry.values()}
        
        # Get all dev-farm containers
        containers = client.containers.list(all=True, filters={'label': 'dev-farm=true'})
        
        cleaned = []
        errors = []
        
        for container in containers:
            # Skip if in registry (not an orphan)
            if container.id in tracked_container_ids:
                continue
            
            # If specific IDs provided, only clean those
            if container_ids and container.id[:12] not in container_ids:
                continue
            
            try:
                # Stop if running
                if container.status == 'running':
                    container.stop(timeout=10)
                
                # Remove container
                container.remove()
                
                cleaned.append({
                    'id': container.id[:12],
                    'name': container.name
                })
            except Exception as e:
                errors.append({
                    'id': container.id[:12],
                    'name': container.name,
                    'error': str(e)
                })
        
        return jsonify({
            'success': len(errors) == 0,
            'cleaned': cleaned,
            'errors': errors
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/system/recover-registry', methods=['POST'])
def recover_registry():
    """Rebuild registry from existing containers and volumes"""
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    try:
        registry = {}
        recovered_count = 0
        
        # Find all containers with dev-farm label or devfarm- prefix
        all_containers = client.containers.list(all=True)
        
        for container in all_containers:
            name = container.name
            # Skip dashboard and updater
            if name in ['devfarm-dashboard', 'devfarm-updater']:
                continue
            
            # Check if it's a devfarm environment container
            if not name.startswith('devfarm-'):
                continue
            
            # Extract environment ID from container name
            env_id = name.replace('devfarm-', '').replace('_', '-')
            
            # Get container details
            try:
                ports = container.attrs['NetworkSettings']['Ports']
                port = None
                for container_port, host_bindings in (ports or {}).items():
                    if host_bindings and '8080/tcp' in container_port:
                        port = int(host_bindings[0]['HostPort'])
                        break
                
                if not port:
                    continue  # Skip containers without port mapping
                
                status = container.status
                
                # Add to registry
                registry[env_id] = {
                    'name': env_id.replace('-', ' ').title(),
                    'container_id': container.id,
                    'container_name': name,
                    'port': port,
                    'status': status,
                    'volume_name': f'devfarm-{env_id}'
                }
                recovered_count += 1
                
            except Exception as e:
                print(f"Error processing container {name}: {e}")
                continue
        
        # Save the recovered registry
        save_registry(registry)
        
        return jsonify({
            'success': True,
            'recovered': recovered_count,
            'environments': registry
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def _run_system_update_thread():
    try:
        _append_stage('init', 'starting', '🚀 Initializing system update...')
        
        # Validate prerequisites
        _append_stage('validate', 'starting', '🔍 Validating environment...')
        
        # GitHub token is optional for public repos (only needed for API rate limits and private repos)
        github_token = load_github_token()
        if github_token:
            _append_stage('validate', 'success', '✅ GitHub token configured')
        else:
            _append_stage('validate', 'info', 'ℹ️ No GitHub token (OK for public repos)')

        if not os.path.exists(REPO_PATH):
            _append_stage('validate', 'error', f'❌ Repository path {REPO_PATH} does not exist')
            _set_update_result(False, f'Repository path {REPO_PATH} does not exist')
            return

        if not os.path.exists(os.path.join(REPO_PATH, '.git')):
            _append_stage('validate', 'error', f'❌ {REPO_PATH} is not a git repository')
            _set_update_result(False, f'{REPO_PATH} is not a git repository')
            return
        
        _append_stage('validate', 'success', '✅ Environment validated')

        # Get current version for comparison
        _append_stage('version_check', 'starting', '📊 Checking current version...')
        try:
            current_sha_result = subprocess.run(
                ['git', 'rev-parse', '--short', 'HEAD'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH,
                check=True
            )
            current_sha = current_sha_result.stdout.strip()
            _append_stage('version_check', 'success', f'📌 Current version: {current_sha}')
        except subprocess.CalledProcessError as e:
            _append_stage('version_check', 'error', f'⚠️ Could not determine current version: {e.stderr}')
            current_sha = 'unknown'

        # Clean any local changes that might block pull - stash everything
        _append_stage('git_clean', 'starting', '🧹 Stashing local changes...')
        try:
            # Stash any uncommitted changes (including untracked files)
            subprocess.run(['git', 'stash', 'push', '-u', '-m', 'Auto-stash before update'], capture_output=True, text=True, cwd=REPO_PATH)
            # Hard reset to ensure clean state
            subprocess.run(['git', 'reset', '--hard', 'HEAD'], check=True, capture_output=True, text=True, cwd=REPO_PATH)
            _append_stage('git_clean', 'success', '✅ Working directory clean')
        except subprocess.CalledProcessError as e:
            _append_stage('git_clean', 'warning', f'⚠️ Clean warning (continuing): {e.stderr.strip() if e.stderr else "unknown"}')

        # Fetch latest changes
        _append_stage('git_fetch', 'starting', '📥 Fetching latest changes from GitHub...')
        try:
            fetch_result = subprocess.run(
                ['git', 'fetch', 'origin', 'main'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH,
                check=True,
                timeout=30
            )
            _append_stage('git_fetch', 'success', '✅ Fetch complete')
        except subprocess.TimeoutExpired:
            _append_stage('git_fetch', 'error', '❌ Fetch timed out. Check network connection.')
            _set_update_result(False, 'Fetch timed out')
            return
        except subprocess.CalledProcessError as e:
            _append_stage('git_fetch', 'error', f'❌ Fetch failed: {e.stderr.strip() if e.stderr else "unknown error"}')
            _set_update_result(False, f'Fetch failed: {e.stderr}')
            return

        # Check what we're about to pull
        _append_stage('version_compare', 'starting', '🔄 Comparing versions...')
        try:
            remote_sha_result = subprocess.run(
                ['git', 'rev-parse', '--short', 'origin/main'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH,
                check=True
            )
            remote_sha = remote_sha_result.stdout.strip()
            
            if current_sha == remote_sha:
                _append_stage('version_compare', 'success', f'✅ Already up to date at {current_sha}')
                _append_stage('version_compare', 'info', 'ℹ️ Force rebuild - will rebuild images anyway')
            else:
                _append_stage('version_compare', 'success', f'🆕 Update available: {current_sha} → {remote_sha}')
        except subprocess.CalledProcessError:
            _append_stage('version_compare', 'warning', '⚠️ Could not compare versions, continuing anyway...')

        # Ensure we're on main branch
        _append_stage('git_checkout', 'starting', '🔀 Ensuring main branch...')
        try:
            subprocess.run(['git', 'checkout', 'main'], check=True, capture_output=True, text=True, cwd=REPO_PATH)
            _append_stage('git_checkout', 'success', '✅ On branch main')
        except subprocess.CalledProcessError as e:
            _append_stage('git_checkout', 'error', f'❌ Checkout failed: {e.stderr.strip() if e.stderr else "unknown error"}')
            _set_update_result(False, 'Checkout failed')
            return

        # Pull latest changes with detailed output
        _append_stage('git_pull', 'starting', '⬇️ Pulling latest code...')
        import subprocess as sp
        proc = sp.Popen(
            ['git', 'pull', 'origin', 'main'],
            cwd=REPO_PATH,
            stdout=sp.PIPE,
            stderr=sp.STDOUT,
            text=True,
            bufsize=1
        )
        pull_output = []
        try:
            for line in iter(proc.stdout.readline, ''):
                if line:
                    clean_line = line.strip()
                    pull_output.append(clean_line)
                    _append_stage('git_pull', 'progress', f'  {clean_line}')
        finally:
            proc.stdout.close()
        rc = proc.wait()
        
        if rc == 0:
            _append_stage('git_pull', 'success', '✅ Code updated successfully')
        else:
            error_msg = '\n'.join(pull_output[-5:]) if pull_output else 'unknown error'
            _append_stage('git_pull', 'error', f'❌ Pull failed: {error_msg}')
            _set_update_result(False, f'git pull failed (exit {rc})')
            return
        
        # Verify the update succeeded
        _append_stage('verify_update', 'starting', '✔️ Verifying update...')
        try:
            new_sha_result = subprocess.run(
                ['git', 'rev-parse', '--short', 'HEAD'],
                capture_output=True,
                text=True,
                cwd=REPO_PATH,
                check=True
            )
            new_sha = new_sha_result.stdout.strip()
            if new_sha != current_sha:
                _append_stage('verify_update', 'success', f'✅ Updated: {current_sha} → {new_sha}')
            else:
                _append_stage('verify_update', 'success', f'✅ Version confirmed: {new_sha}')
        except subprocess.CalledProcessError:
            _append_stage('verify_update', 'warning', '⚠️ Could not verify update')

        # Stage 2: Analyze what changed
        _append_stage('check_changes', 'starting', '🔍 Analyzing changes...')
        diff_result = subprocess.run(
            ['git', 'diff', 'HEAD@{1}', 'HEAD', '--name-only'],
            capture_output=True,
            text=True,
            cwd=REPO_PATH
        )
        files_changed = diff_result.stdout.split('\n') if diff_result.stdout else []
        
        if files_changed and files_changed[0]:
            _append_stage('check_changes', 'progress', f'📝 {len([f for f in files_changed if f])} files changed')
        
        # Check if code-server image needs rebuild
        codeserver_changed = any(
            'Dockerfile.code-server' in f or 
            'docker/config/startup.sh' in f or
            'docker/config/mcp-copilot.json' in f or
            'docker/config/workspace-settings.json' in f or
            'docker/config/auto-approval-settings.json' in f
            for f in files_changed
        )
        
        # Check if dashboard needs rebuild
        dashboard_changed = any(
            'dashboard/Dockerfile' in f or
            'dashboard/templates/' in f or
            'dashboard/app.py' in f
            for f in files_changed
        )
        
        _append_stage('check_changes', 'success', f'✅ Code-server changes: {"YES" if codeserver_changed else "NO"}, Dashboard changes: {"YES" if dashboard_changed else "NO"}')
        _append_stage('check_changes', 'info', '📦 Rebuilding both images to ensure everything is up to date...')

        # Stage 3: Always rebuild code-server to ensure latest updates
        if True:  # Always rebuild
            _append_stage('rebuild_codeserver', 'starting', '🔨 Rebuilding code-server image...')
            try:
                # Ensure updater exists
                try:
                    updater = client.containers.get('devfarm-updater')
                    if updater.status != 'running':
                        updater.start()
                        time.sleep(1)
                except docker.errors.NotFound:
                    _append_stage('rebuild_codeserver', 'progress', '📦 Creating updater container...')
                    updater = client.containers.run(
                        'docker:27-cli',
                        name='devfarm-updater',
                        volumes={
                            '/var/run/docker.sock': {'bind': '/var/run/docker.sock', 'mode': 'rw'},
                            REPO_PATH: {'bind': REPO_PATH, 'mode': 'rw'}
                        },
                        command='tail -f /dev/null',
                        detach=True,
                        restart_policy={'Name': 'unless-stopped'},
                        network_mode='bridge'
                    )
                    time.sleep(2)
                
                _append_stage('rebuild_codeserver', 'progress', '⏳ Building... (this may take 1-2 minutes)')
                
                # Run build in background and poll for completion
                # Using sh to redirect output to file so we can monitor progress
                build_cmd = f'docker build --no-cache -t dev-farm/code-server:latest -f {REPO_PATH}/docker/Dockerfile.code-server {REPO_PATH}/docker > /tmp/codeserver-build.log 2>&1; echo $? > /tmp/codeserver-build.exit'
                exec_id = updater.client.api.exec_create(
                    updater.id,
                    ['sh', '-c', build_cmd]
                )['Id']
                updater.client.api.exec_start(exec_id, detach=True)
                
                # Poll for completion (check every 3 seconds for up to 5 minutes)
                for i in range(100):
                    time.sleep(3)
                    check_result = updater.exec_run(['sh', '-c', 'test -f /tmp/codeserver-build.exit && cat /tmp/codeserver-build.exit || echo "running"'], demux=False)
                    status = check_result.output.decode('utf-8').strip() if check_result.output else 'running'
                    
                    if status != 'running':
                        exit_code = int(status)
                        # Get the last 50 lines of build output for context
                        log_result = updater.exec_run(['sh', '-c', 'tail -50 /tmp/codeserver-build.log'], demux=False)
                        build_log = log_result.output.decode('utf-8', errors='replace') if log_result.output else ''
                        
                        # Clean up temp files
                        updater.exec_run(['sh', '-c', 'rm -f /tmp/codeserver-build.log /tmp/codeserver-build.exit'], demux=False)
                        break
                    
                    if i % 10 == 0 and i > 0:  # Every 30 seconds
                        _append_stage('rebuild_codeserver', 'progress', f'⏳ Still building... ({i*3}s elapsed)')
                else:
                    # Timeout after 5 minutes
                    _append_stage('rebuild_codeserver', 'error', '❌ Build timeout after 5 minutes')
                    _set_update_result(False, 'Code-server build timeout')
                    return
                
                if exit_code == 0:
                    _append_stage('rebuild_codeserver', 'success', '✅ Code-server image rebuilt successfully')
                    
                    # Prune old/dangling images to free space and prevent confusion
                    _append_stage('rebuild_codeserver', 'progress', '🧹 Cleaning up old images...')
                    try:
                        prune_result = updater.exec_run(
                            cmd=['sh', '-c', 'docker image prune -f'],
                            demux=False
                        )
                        if prune_result.exit_code == 0:
                            _append_stage('rebuild_codeserver', 'success', '✅ Old images cleaned up')
                    except Exception:
                        pass  # Non-critical, continue
                else:
                    _append_stage('rebuild_codeserver', 'error', f'❌ Build failed (exit {exit_code}): {build_log[-400:]}')
                    _set_update_result(False, 'Failed to rebuild code-server image')
                    return
            except Exception as e:
                _append_stage('rebuild_codeserver', 'error', f'❌ Error: {str(e)}')
                _set_update_result(False, f'Code-server rebuild error: {str(e)}')
                return

        # Stage 4: Always rebuild and restart dashboard (it's quick and ensures latest code)
        _append_stage('rebuild_dashboard', 'starting', '🔨 Rebuilding dashboard image...')
        
        try:
            # Ensure updater exists and is running
            try:
                updater = client.containers.get('devfarm-updater')
                if updater.status != 'running':
                    updater.start()
                    time.sleep(1)
            except docker.errors.NotFound:
                _append_stage('rebuild_dashboard', 'progress', '📦 Creating updater container...')
                updater = client.containers.run(
                    'docker:27-cli',
                    name='devfarm-updater',
                    volumes={
                        '/var/run/docker.sock': {'bind': '/var/run/docker.sock', 'mode': 'rw'},
                        REPO_PATH: {'bind': REPO_PATH, 'mode': 'rw'}
                    },
                    command='tail -f /dev/null',
                    detach=True,
                    restart_policy={'Name': 'unless-stopped'},
                    network_mode='bridge'
                )
                time.sleep(2)

            _append_stage('rebuild_dashboard', 'progress', '⏳ Building dashboard...')
            
            # Run build in background and poll for completion
            build_cmd = f'cd {REPO_PATH} && docker build --no-cache -t dev-farm-dashboard:latest ./dashboard > /tmp/dashboard-build.log 2>&1; echo $? > /tmp/dashboard-build.exit'
            exec_id = updater.client.api.exec_create(
                updater.id,
                ['sh', '-c', build_cmd]
            )['Id']
            updater.client.api.exec_start(exec_id, detach=True)
            
            # Poll for completion
            for i in range(100):
                time.sleep(3)
                check_result = updater.exec_run(['sh', '-c', 'test -f /tmp/dashboard-build.exit && cat /tmp/dashboard-build.exit || echo "running"'], demux=False)
                status = check_result.output.decode('utf-8').strip() if check_result.output else 'running'
                
                if status != 'running':
                    exit_code = int(status)
                    log_result = updater.exec_run(['sh', '-c', 'tail -50 /tmp/dashboard-build.log'], demux=False)
                    build_log = log_result.output.decode('utf-8', errors='replace') if log_result.output else ''
                    updater.exec_run(['sh', '-c', 'rm -f /tmp/dashboard-build.log /tmp/dashboard-build.exit'], demux=False)
                    break
                
                if i % 10 == 0 and i > 0:
                    _append_stage('rebuild_dashboard', 'progress', f'⏳ Still building dashboard... ({i*3}s elapsed)')
            else:
                _append_stage('rebuild_dashboard', 'error', '❌ Dashboard build timeout after 5 minutes')
                _set_update_result(False, 'Dashboard build timeout')
                return
            
            if exit_code != 0:
                _append_stage('rebuild_dashboard', 'error', f'❌ Build failed (exit {exit_code}): {build_log[-400:]}')
                _set_update_result(False, 'Failed to rebuild dashboard image')
                return
            
            _append_stage('rebuild_dashboard', 'success', '✅ Dashboard image rebuilt')
            
            # Verify the image exists before attempting restart
            try:
                client.images.get('dev-farm-dashboard:latest')
                _append_stage('restart_dashboard', 'starting', '🔄 Recreating dashboard container...')
            except docker.errors.ImageNotFound:
                _append_stage('restart_dashboard', 'error', '❌ Dashboard image not found - aborting restart')
                _set_update_result(False, 'Dashboard image verification failed')
                return

            # CRITICAL FIX: Use updater container to perform restart
            # Running restart from inside dashboard (daemon thread) fails because 
            # container dies before restart completes. Updater container stays alive.
            _append_stage('restart_dashboard', 'starting', '🔄 Scheduling dashboard restart via updater...')
            
            restart_script = f"""#!/bin/sh
set -e
echo "Waiting 5 seconds for dashboard to finish current request..."
sleep 5

echo "Stopping services..."
docker compose -f {REPO_PATH}/docker-compose.yml stop proxy dashboard || true

echo "Removing old containers..."
docker compose -f {REPO_PATH}/docker-compose.yml rm -f proxy dashboard || true

echo "Starting services with new images..."
docker compose -f {REPO_PATH}/docker-compose.yml up -d proxy dashboard

echo "Waiting for services to be healthy..."
for i in $(seq 1 60); do
    sleep 1
    DASH_STATUS=$(docker inspect --format='{{{{.State.Status}}}}' devfarm-dashboard 2>/dev/null || echo "not_found")
    PROXY_STATUS=$(docker inspect --format='{{{{.State.Status}}}}' devfarm-proxy 2>/dev/null || echo "not_found")
    echo "Check $i: Dashboard=$DASH_STATUS, Proxy=$PROXY_STATUS"
    
    if [ "$DASH_STATUS" = "running" ] && [ "$PROXY_STATUS" = "running" ]; then
        echo "✅ Services are running after $i seconds"
        exit 0
    fi
done

echo "❌ Services failed to start within 60 seconds"
echo "Dashboard: $(docker inspect --format='{{{{.State.Status}}}}' devfarm-dashboard 2>/dev/null || echo 'not found')"
echo "Proxy: $(docker inspect --format='{{{{.State.Status}}}}' devfarm-proxy 2>/dev/null || echo 'not found')"
exit 1
"""
            
            try:
                # Write restart script to updater container
                exec_result = updater.exec_run(
                    cmd=['sh', '-c', f'cat > /tmp/restart-dashboard.sh << "EOFSCRIPT"\n{restart_script}\nEOFSCRIPT\nchmod +x /tmp/restart-dashboard.sh'],
                    demux=False
                )
                
                if exec_result.exit_code != 0:
                    raise Exception(f"Failed to create restart script: {exec_result.output}")
                
                # Execute restart script in background (non-blocking)
                # Use nohup so script continues even if exec connection dies
                exec_result = updater.exec_run(
                    cmd=['sh', '-c', 'nohup sh /tmp/restart-dashboard.sh > /tmp/restart.log 2>&1 &'],
                    detach=True
                )
                
                print("Services restart scheduled via updater container")
                _append_stage('restart_dashboard', 'success', '✅ Services restart scheduled (reloading in 10s...)')
                
            except Exception as e:
                print(f"ERROR: Failed to schedule restart via updater: {e}")
                _append_stage('restart_dashboard', 'error', f'❌ Failed to schedule restart: {str(e)}')
                _append_stage('restart_dashboard', 'info', '⚠️  Manual restart required: docker compose up -d proxy dashboard')
                _set_update_result(False, f'Restart scheduling failed: {str(e)}')
                return
        except Exception as e:
            _append_stage('restart_dashboard', 'error', f'❌ Error: {str(e)}')
            _set_update_result(False, f'Dashboard restart error: {str(e)}')
            return

        _append_stage('complete', 'success', '🎉 System update completed successfully!')
        _append_stage('complete', 'info', 'ℹ️  Existing environments will use new image on next restart/recreate')
        _set_update_result(True)
    except subprocess.CalledProcessError as e:
        error_msg = 'Command failed'
        if e.stdout:
            error_msg = e.stdout if isinstance(e.stdout, str) else e.stdout.decode('utf-8')
        elif e.stderr:
            error_msg = e.stderr if isinstance(e.stderr, str) else e.stderr.decode('utf-8')
        _append_stage('error', 'error', f'❌ {error_msg}')
        _set_update_result(False, error_msg)
    except Exception as e:
        _append_stage('error', 'error', f'❌ Unexpected error: {str(e)}')
        _set_update_result(False, str(e))


@app.route('/api/system/update/start', methods=['POST'])
def system_update_start():
    """Start system update in background and return immediately"""
    try:
        with UPDATE_LOCK:
            if UPDATE_PROGRESS.get('running'):
                return jsonify({'started': False, 'message': 'Update already in progress'}), 409
            _reset_update_progress()
        
        # Call _append_stage OUTSIDE the lock since it also acquires UPDATE_LOCK
        _append_stage('queued', 'info', 'Update request accepted')
        
        # Broadcast SSE event to notify UI that update started
        broadcast_sse('update-started', {'timestamp': time.time()})
        
        # Use gevent greenlets when running under gevent workers
        if USING_GEVENT:
            gevent_spawn(_run_system_update_thread)
        else:
            threading.Thread(target=_run_system_update_thread, daemon=True).start()
        
        return jsonify({'started': True})
    except Exception as e:
        print(f"ERROR in system_update_start: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'started': False, 'error': str(e)}), 500


@app.route('/api/system/update/status')
def system_update_status():
    """Return current update progress"""
    with UPDATE_LOCK:
        return jsonify(UPDATE_PROGRESS)

# ============================================================================
# AI Chat Interface (Aider and gh copilot CLI)
# ============================================================================

# Track active AI sessions per environment
AI_SESSIONS = {}
AI_SESSIONS_LOCK = threading.Lock()

def ensure_tmux_server(container):
    """
    Ensure tmux server is running in the container.
    This prevents "error connecting to /tmp/tmux-1000/default" errors.
    
    Args:
        container: Docker container object (from docker.containers.get())
        
    Note:
        This function is idempotent - calling it multiple times is safe.
        tmux start-server will not fail if a server is already running.
    """
    try:
        result = container.exec_run(
            'tmux start-server',
            user='coder'
        )
        # tmux start-server typically returns 0 even if server already running
        # Log only if there's an unexpected error
        if result.exit_code != 0 and result.output:
            print(f"Warning: tmux start-server returned {result.exit_code}: {result.output.decode('utf-8', errors='ignore')}")
    except Exception as e:
        # Log but don't fail - the subsequent tmux commands will show the real error
        print(f"Warning: Failed to start tmux server: {e}")

@app.route('/api/environments/<env_id>/ai/chat', methods=['POST'])
def ai_chat(env_id):
    """Send a message to AI tools (Aider or gh copilot) in the environment"""
    data = request.get_json()
    message = data.get('message', '')
    tool = data.get('tool', 'aider')  # 'aider' or 'copilot'
    
    if not message:
        return jsonify({'error': 'Message is required'}), 400
    
    registry = load_registry()
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    container_name = f"devfarm-{env_id}"
    
    try:
        container = client.containers.get(container_name)
        
        # Start AI session if not exists
        with AI_SESSIONS_LOCK:
            if env_id not in AI_SESSIONS or not AI_SESSIONS[env_id].get('active'):
                AI_SESSIONS[env_id] = {
                    'tool': tool,
                    'active': True,
                    'session_id': secrets.token_hex(8)
                }
        
        # Send message to AI tool via tmux
        if tool == 'aider':
            # Ensure tmux server is running to prevent connection errors
            ensure_tmux_server(container)
            
            # Start aider in tmux if not running
            session_check = container.exec_run(
                'tmux has-session -t devfarm-ai 2>/dev/null',
                user='coder'
            )
            
            if session_check.exit_code != 0:
                # Start aider in new tmux session
                container.exec_run(
                    'tmux new-session -d -s devfarm-ai "cd /workspace && aider --yes-always --message-file /tmp/aider-input.txt"',
                    user='coder',
                    workdir='/workspace'
                )
                time.sleep(2)  # Give aider time to start
            
            # Write message to input file
            container.exec_run(
                f'bash -c "echo {repr(message)} > /tmp/aider-input.txt"',
                user='coder'
            )
            
            # Send message to aider
            container.exec_run(
                f'tmux send-keys -t devfarm-ai {repr(message)} Enter',
                user='coder'
            )
            
        elif tool == 'copilot':
            # Use gh copilot suggest
            result = container.exec_run(
                f'gh copilot suggest {repr(message)}',
                user='coder',
                workdir='/workspace'
            )
            
            # Broadcast response immediately
            broadcast_sse('ai-response', {
                'env_id': env_id,
                'tool': tool,
                'response': result.output.decode('utf-8') if result.output else '',
                'timestamp': datetime.now().isoformat()
            })
        
        return jsonify({
            'success': True,
            'session_id': AI_SESSIONS[env_id]['session_id'],
            'message': f'Message sent to {tool}'
        })
        
    except docker.errors.NotFound:
        return jsonify({'error': 'Container not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/environments/<env_id>/ai/output')
def ai_output(env_id):
    """Get recent output from AI tool"""
    registry = load_registry()
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    container_name = f"devfarm-{env_id}"
    
    try:
        container = client.containers.get(container_name)
        
        # Ensure tmux server is running to prevent connection errors
        ensure_tmux_server(container)
        
        # Get output from AI tmux session
        result = container.exec_run(
            'tmux capture-pane -t devfarm-ai -p -S -50',
            user='coder'
        )
        
        output = result.output.decode('utf-8') if result.output else ''
        
        return jsonify({
            'output': output,
            'timestamp': datetime.now().isoformat()
        })
        
    except docker.errors.NotFound:
        return jsonify({'error': 'Container not found'}), 404
    except Exception as e:
        return jsonify({'output': '', 'error': str(e)})


@app.route('/api/environments/<env_id>/ai/stop', methods=['POST'])
def ai_stop(env_id):
    """Stop the AI session"""
    container_name = f"devfarm-{env_id}"
    
    try:
        container = client.containers.get(container_name)
        
        # Ensure tmux server is running to prevent connection errors
        ensure_tmux_server(container)
        
        # Kill AI tmux session
        container.exec_run(
            'tmux kill-session -t devfarm-ai 2>/dev/null',
            user='coder'
        )
        
        with AI_SESSIONS_LOCK:
            if env_id in AI_SESSIONS:
                AI_SESSIONS[env_id]['active'] = False
        
        return jsonify({'success': True})
        
    except docker.errors.NotFound:
        return jsonify({'error': 'Container not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# Enhanced Monitoring APIs
# ============================================================================

@app.route('/api/environments/<env_id>/terminal-preview')
def get_terminal_preview(env_id):
    """Get last 50 lines of tmux output"""
    registry = load_registry()
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    container_name = f"devfarm-{env_id}"
    
    try:
        container = client.containers.get(container_name)
        
        # Ensure tmux server is running to prevent connection errors
        ensure_tmux_server(container)
        
        # Capture tmux output
        result = container.exec_run(
            'tmux capture-pane -t devfarm -p -S -50 2>/dev/null || echo "No active session"',
            user='coder'
        )
        
        return jsonify({
            'output': result.output.decode('utf-8') if result.output else '',
            'timestamp': datetime.now().isoformat()
        })
    except docker.errors.NotFound:
        return jsonify({'error': 'Container not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/environments/<env_id>/git-activity')
def get_git_activity(env_id):
    """Get recent git commits"""
    registry = load_registry()
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    container_name = f"devfarm-{env_id}"
    
    try:
        container = client.containers.get(container_name)
        
        # Get last 10 commits
        result = container.exec_run(
            'git log --oneline -10 --format="%H|%an|%ar|%s" 2>/dev/null || echo ""',
            workdir='/workspace',
            user='coder'
        )
        
        commits = []
        output = result.output.decode('utf-8') if result.output else ''
        for line in output.strip().split('\n'):
            if line and '|' in line:
                try:
                    sha, author, time_ago, message = line.split('|', 3)
                    commits.append({
                        'sha': sha[:7],
                        'author': author,
                        'time': time_ago,
                        'message': message
                    })
                except ValueError:
                    continue
        
        return jsonify({'commits': commits})
    except docker.errors.NotFound:
        return jsonify({'commits': []})
    except Exception as e:
        return jsonify({'commits': [], 'error': str(e)})


@app.route('/api/environments/<env_id>/processes')
def get_processes(env_id):
    """Get running processes"""
    registry = load_registry()
    if env_id not in registry:
        return jsonify({'error': 'Environment not found'}), 404
    
    container_name = f"devfarm-{env_id}"
    
    try:
        container = client.containers.get(container_name)
        
        # Get processes (filter common ones)
        result = container.exec_run(
            "ps aux | grep -E 'aider|code-insiders|node|python|npm|gh' | grep -v grep",
            user='coder'
        )
        
        processes = []
        output = result.output.decode('utf-8') if result.output else ''
        for line in output.strip().split('\n'):
            if line:
                parts = line.split()
                if len(parts) >= 11:
                    processes.append({
                        'pid': parts[1],
                        'cpu': parts[2],
                        'mem': parts[3],
                        'time': parts[9],
                        'command': ' '.join(parts[10:])[:100]  # Truncate long commands
                    })
        
        return jsonify({'processes': processes})
    except docker.errors.NotFound:
        return jsonify({'processes': []})
    except Exception as e:
        return jsonify({'processes': [], 'error': str(e)})


def background_status_monitor():
    """Monitor container status changes and broadcast SSE updates"""
    import threading
    import time
    
    def monitor_loop():
        while True:
            try:
                time.sleep(2)  # Check every 2 seconds for responsive UI
                registry = load_registry()
                
                if not client:
                    continue
                
                for env_id, env_data in registry.items():
                    try:
                        container = client.containers.get(env_data['container_id'])
                        status = container.status
                        ready = is_env_ready(container.name, env_data.get('port')) if status == 'running' else False
                        display_status = 'running' if ready else ('starting' if status == 'running' else status)
                        
                        # Check if status changed
                        with STATUS_LOCK:
                            last_status = LAST_KNOWN_STATUS.get(env_id)
                            if last_status != display_status:
                                LAST_KNOWN_STATUS[env_id] = display_status
                                # Broadcast status change
                                broadcast_sse('env-status', {
                                    'env_id': env_id,
                                    'status': display_status,
                                    'port': env_data.get('port')
                                })
                    except docker.errors.NotFound:
                        # Container was deleted
                        with STATUS_LOCK:
                            if env_id in LAST_KNOWN_STATUS:
                                del LAST_KNOWN_STATUS[env_id]
                    except Exception as e:
                        # Ignore transient errors
                        pass
            except Exception as e:
                print(f"Background monitor error: {e}")
    
    thread = threading.Thread(target=monitor_loop, daemon=True)
    thread.start()

def background_registry_sync():
    """Background task to keep registry in sync with containers"""
    import threading
    import time
    
    def sync_loop():
        while True:
            try:
                time.sleep(30)  # Sync every 30 seconds
                sync_registry_with_containers()
            except Exception as e:
                print(f"Background sync error: {e}")
    
    thread = threading.Thread(target=sync_loop, daemon=True)
    thread.start()

# Start background monitoring threads when module loads (works with gunicorn)
background_status_monitor()
background_registry_sync()

if __name__ == '__main__':
    # Only runs when executing directly (not under gunicorn)
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('DEBUG', 'false').lower() == 'true')
