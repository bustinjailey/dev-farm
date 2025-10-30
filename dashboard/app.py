#!/usr/bin/env python3
"""
Dev Farm Dashboard - Mobile-friendly web interface for managing development environments
"""

from flask import Flask, render_template, jsonify, request, redirect, url_for, session, Response, stream_with_context
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

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-farm-secret-key')

# Docker client
try:
    client = docker.from_env()
except Exception as e:
    print(f"Warning: Could not connect to Docker: {e}")
    client = None

REGISTRY_FILE = '/data/environments.json'
BASE_PORT = 8100
GITHUB_TOKEN_FILE = '/data/.github_token'
DEVICE_CODE_FILE = '/data/.device_code.json'
REPO_PATH = os.environ.get('HOST_REPO_PATH', '/opt/dev-farm')

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
            'error': None
        })

def _append_stage(stage, status, message=None):
    with UPDATE_LOCK:
        UPDATE_PROGRESS['stages'].append({
            'stage': stage,
            'status': status,
            'message': message
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

def load_github_token():
    """Load GitHub token from shared storage"""
    # Try file storage first (persistent across restarts)
    if os.path.exists(GITHUB_TOKEN_FILE):
        try:
            with open(GITHUB_TOKEN_FILE, 'r') as f:
                token = f.read().strip()
                if token:
                    return token
        except:
            pass
    # Fall back to environment variable
    return os.environ.get('GITHUB_TOKEN', '')

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
    """Probe the environment container to determine readiness.
    Returns True when HTTP responds successfully.
    First tries container healthcheck status, then falls back to HTTP probe.
    """
    try:
        # First check Docker healthcheck status if available
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
                    # If no healthcheck or unknown status, fall through to HTTP probe
            except Exception:
                pass
        
        # Fallback: Try HTTP probe via container network
        try:
            resp = requests.get(f'http://{container_name}:8080', timeout=1.5)
            return 200 <= resp.status_code < 400
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
                
                environments.append({
                    'name': env_data.get('display_name', env_id),  # Use display_name if available
                    'id': env_id,
                    'port': env_data['port'],
                    'status': display_status,
                    'created': env_data.get('created', 'Unknown'),
                    'project': env_data.get('project', 'general'),
                    'mode': env_data.get('mode', 'workspace'),
                    'ssh_host': env_data.get('ssh_host'),
                    'git_url': env_data.get('git_url'),
                    'stats': stats,
                    'ready': ready,
                    'url': f"http://{request.host.split(':')[0]}:{env_data['port']}?folder=/home/coder/workspace"
                })
            except docker.errors.NotFound:
                # Container no longer exists
                pass
    
    return render_template('index.html', environments=environments)

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
                    # Get message from queue with timeout
                    message = client_queue.get(timeout=30)
                    event_type = message.get('event', 'message')
                    data = message.get('data', {})
                    yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                except queue.Empty:
                    # Send heartbeat to keep connection alive
                    yield f": heartbeat\n\n"
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
                hostname = request.host.split(':')[0]
                environments.append({
                    'name': env_data.get('display_name', env_id),
                    'id': env_id,
                    'port': env_data['port'],
                    'status': display_status,
                    'ready': ready,
                    'url': f"http://{hostname}:{env_data['port']}?folder=/home/coder/workspace"
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
    mode = data.get('mode', 'workspace')  # workspace, ssh, or git
    
    # Mode-specific parameters
    ssh_host = data.get('ssh_host', '')
    ssh_user = data.get('ssh_user', '')
    ssh_path = data.get('ssh_path', '/home')
    ssh_password = data.get('ssh_password', '')  # Optional password for SSH authentication
    git_url = data.get('git_url', '')
    
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
    sync_registry_with_containers()  # Clean up stale registry entries before checking
    registry = load_registry()
    
    # Check if environment ID already exists
    if env_id in registry:
        return jsonify({'error': f'Environment "{display_name}" (ID: {env_id}) already exists'}), 400
    
    port = get_next_port()
    
    try:
        # Get GitHub configuration from shared storage or environment
        github_token = load_github_token()
        github_username = os.environ.get('GITHUB_USERNAME', 'bustinjailey')
        github_email = os.environ.get('GITHUB_EMAIL', f'{github_username}@users.noreply.github.com')
        
        if not github_token:
            print("Warning: GITHUB_TOKEN not set. Environments will not have GitHub authentication.")
        
        # Create container with environment variables
        print(f"Creating container {env_id} ('{display_name}') with port mapping: 8080/tcp -> {port}")
        
        # Build environment variables
        env_vars = {
            'GITHUB_TOKEN': github_token,
            'GITHUB_USERNAME': github_username,
            'GITHUB_EMAIL': github_email,
            'DEV_MODE': mode,
            'WORKSPACE_NAME': display_name  # Pass display name for workspace tab
        }
        
        # Add mode-specific environment variables
        if mode == 'ssh':
            env_vars['SSH_HOST'] = ssh_host
            env_vars['SSH_USER'] = ssh_user
            env_vars['SSH_PATH'] = ssh_path
            if ssh_password:  # Only add password if provided
                env_vars['SSH_PASSWORD'] = ssh_password
        elif mode == 'git':
            env_vars['GIT_URL'] = git_url
        
        # Container run options
        run_kwargs = {
            'image': 'dev-farm/code-server:latest',
            'name': f"devfarm-{env_id}",
            'detach': True,
            'ports': {'8080/tcp': port},  # Map container's internal 8080 to host's external port
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
        if mode in ['workspace', 'git']:
            run_kwargs['volumes'] = {
                f'devfarm-{env_id}': {'bind': '/home/coder/workspace', 'mode': 'rw'}
            }

        # For ssh mode, enable FUSE for SSHFS mounts
        # Using privileged mode to ensure FUSE mounts work properly
        if mode == 'ssh':
            run_kwargs.update({
                'privileged': True
            })

        # Ensure no stale container exists with this name
        container_name = f"devfarm-{env_id}"
        try:
            existing = client.containers.get(container_name)
            existing.stop(timeout=5)
            existing.remove(force=True)
        except Exception:
            pass  # No existing container, proceed

        container = client.containers.run(**run_kwargs)
        
        # Register environment with both display name and ID
        registry[env_id] = {
            'display_name': display_name,
            'env_id': env_id,
            'container_id': container.id,
            'port': port,
            'created': datetime.now().isoformat(),
            'project': project,
            'mode': mode,
            'ssh_host': ssh_host if mode == 'ssh' else None,
            'ssh_password': ssh_password if mode == 'ssh' and ssh_password else None,  # Store password if provided
            'git_url': git_url if mode == 'git' else None
        }
        save_registry(registry)
        
        return jsonify({
            'success': True,
            'name': display_name,
            'id': env_id,
            'port': port,
            'url': f"http://{request.host.split(':')[0]}:{port}?folder=/home/coder/workspace"
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
        
        # Get user's repositories
        response = requests.get('https://api.github.com/user/repos', headers=headers, params={
            'sort': 'updated',
            'per_page': 50
        })
        
        if response.status_code == 200:
            repos = response.json()
            return jsonify([{
                'name': repo['full_name'],
                'url': repo['clone_url'],
                'description': repo['description'],
                'updated': repo['updated_at']
            } for repo in repos])
        else:
            return jsonify({'error': 'Failed to fetch repositories'}), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/github/auth/start', methods=['POST'])
def github_auth_start():
    """Start GitHub OAuth device flow"""
    try:
        # Request device code from GitHub
        response = requests.post(
            'https://github.com/login/device/code',
            headers={'Accept': 'application/json'},
            data={'client_id': 'Iv1.b507a08c87ecfe98', 'scope': 'repo read:org workflow copilot'}
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
                _set_update_result(True)
                return
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
            'docker/config/mcp.json' in f or
            'docker/config/settings.json' in f
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
                exec_result = updater.exec_run(
                    cmd=['sh', '-c', f'docker build --no-cache -t dev-farm/code-server:latest -f {REPO_PATH}/docker/Dockerfile.code-server {REPO_PATH}/docker'],
                    demux=False
                )
                if exec_result.exit_code == 0:
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
                    error_output = exec_result.output.decode('utf-8', errors='replace') if exec_result.output else 'unknown error'
                    _append_stage('rebuild_codeserver', 'error', f'❌ Build failed: {error_output[-200:]}')
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
            exec_result = updater.exec_run(
                cmd=['sh', '-c', f'cd {REPO_PATH} && docker build --no-cache -t dev-farm-dashboard:latest ./dashboard'],
                demux=False
            )
            if exec_result.exit_code != 0:
                error_output = exec_result.output.decode('utf-8', errors='replace') if exec_result.output else 'unknown error'
                _append_stage('rebuild_dashboard', 'error', f'❌ Build failed: {error_output[-200:]}')
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

            def delayed_recreate():
                time.sleep(3)  # Give time for status response to be sent
                
                try:
                    print("Restarting dashboard using docker compose...")
                    
                    # Two-step approach for reliability:
                    # 1. Stop the current dashboard
                    print("Step 1: Stopping current dashboard...")
                    stop_result = subprocess.run(
                        ['docker', 'compose', 'stop', 'dashboard'],
                        cwd='/opt/dev-farm',
                        capture_output=True,
                        text=True,
                        timeout=15
                    )
                    print(f"Stop result: {stop_result.returncode}")
                    
                    # 2. Remove the old container
                    print("Step 2: Removing old container...")
                    rm_result = subprocess.run(
                        ['docker', 'compose', 'rm', '-f', 'dashboard'],
                        cwd='/opt/dev-farm',
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    print(f"Remove result: {rm_result.returncode}")
                    
                    # 3. Create container with new image (--no-build uses pre-built image)
                    print("Step 3: Creating dashboard container with new image...")
                    result = subprocess.run(
                        ['docker', 'compose', 'create', '--no-build', 'dashboard'],
                        cwd='/opt/dev-farm',
                        capture_output=True,
                        text=True,
                        timeout=30
                    )
                    
                    if result.returncode == 0:
                        print("Dashboard container created successfully")
                        print(result.stdout)
                        
                        # Now explicitly start the container
                        print("Step 4: Starting dashboard container...")
                        start_result = subprocess.run(
                            ['docker', 'compose', 'start', 'dashboard'],
                            cwd='/opt/dev-farm',
                            capture_output=True,
                            text=True,
                            timeout=30
                        )
                        
                        if start_result.returncode != 0:
                            print(f"WARNING: docker compose start failed: {start_result.stderr}")
                            # Fallback to direct docker start
                            print("Attempting direct docker start...")
                            try:
                                dashboard = client.containers.get('devfarm-dashboard')
                                dashboard.start()
                                print("Dashboard started via direct docker API")
                            except Exception as e:
                                print(f"ERROR: Failed to start dashboard: {e}")
                                raise
                        else:
                            print("Dashboard started successfully via docker compose")
                        
                        # Wait for dashboard to be healthy
                        print("Waiting for dashboard to be healthy...")
                        for i in range(30):  # Wait up to 30 seconds
                            time.sleep(1)
                            try:
                                dashboard = client.containers.get('devfarm-dashboard')
                                state = dashboard.status
                                print(f"  Check {i+1}: Status={state}")
                                
                                if state == 'running':
                                    # Check health if healthcheck exists
                                    health = dashboard.attrs.get('State', {}).get('Health', {})
                                    if health and health.get('Status') == 'healthy':
                                        print(f"✅ Dashboard is healthy after {i+1} seconds")
                                        break
                                    elif not health:
                                        # No healthcheck, just verify it's running
                                        print(f"✅ Dashboard is running (no healthcheck) after {i+1} seconds")
                                        break
                                elif state == 'created':
                                    print(f"  WARNING: Container still in 'created' state - this shouldn't happen")
                            except Exception as e:
                                print(f"  Check {i+1}: Error - {e}")
                        else:
                            print("⚠️ Dashboard may not be fully healthy yet but continuing...")
                            # Verify it's at least running
                            try:
                                dashboard = client.containers.get('devfarm-dashboard')
                                if dashboard.status != 'running':
                                    print(f"❌ CRITICAL: Dashboard is in '{dashboard.status}' state, not running!")
                            except:
                                pass
                    else:
                        print(f"docker compose restart failed with code {result.returncode}")
                        print(f"stdout: {result.stdout}")
                        print(f"stderr: {result.stderr}")
                        
                        # Fallback: try docker compose restart (less disruptive)
                        print("Attempting fallback with docker compose restart...")
                        fallback_result = subprocess.run(
                            ['docker', 'compose', 'restart', 'dashboard'],
                            cwd='/opt/dev-farm',
                            capture_output=True,
                            text=True,
                            timeout=30
                        )
                        
                        if fallback_result.returncode == 0:
                            print("Dashboard restarted successfully via docker compose restart")
                        else:
                            print(f"Fallback restart also failed: {fallback_result.stderr}")
                            raise Exception("Both docker compose up and restart failed")
                    
                except subprocess.TimeoutExpired:
                    print("ERROR: docker compose command timed out")
                    print("Dashboard may be in an inconsistent state - manual intervention required")
                except Exception as e:
                    print(f"Critical error during dashboard recreation: {e}")
                    import traceback
                    traceback.print_exc()
                    print("Dashboard is likely DOWN - manual intervention required")
                    print("To recover, run: cd /opt/dev-farm && docker compose up -d dashboard")

            threading.Thread(target=delayed_recreate, daemon=True).start()
            _append_stage('restart_dashboard', 'success', '✅ Dashboard recreation initiated (reloading in 5s...)')
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
    with UPDATE_LOCK:
        if UPDATE_PROGRESS.get('running'):
            return jsonify({'started': False, 'message': 'Update already in progress'}), 409
        _reset_update_progress()
        _append_stage('queued', 'info', 'Update request accepted')

    threading.Thread(target=_run_system_update_thread, daemon=True).start()
    return jsonify({'started': True})


@app.route('/api/system/update/status')
def system_update_status():
    """Return current update progress"""
    with UPDATE_LOCK:
        return jsonify(UPDATE_PROGRESS)

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
