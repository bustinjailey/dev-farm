#!/usr/bin/env python3
"""
Dev Farm Dashboard - Mobile-friendly web interface for managing development environments
"""

from flask import Flask, render_template, jsonify, request, redirect, url_for, session
import docker
import os
import json
import subprocess
from datetime import datetime
import secrets
import re
import time
import requests

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
REPO_PATH = '/opt'

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
    """Save the registry of dev environments"""
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    with open(REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2)

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

@app.route('/')
def index():
    """Main dashboard page"""
    registry = load_registry()
    environments = []
    
    if client:
        for env_id, env_data in registry.items():
            try:
                container = client.containers.get(env_data['container_id'])
                status = container.status
                stats = get_container_stats(container) if status == 'running' else {}
                
                environments.append({
                    'name': env_data.get('display_name', env_id),  # Use display_name if available
                    'id': env_id,
                    'port': env_data['port'],
                    'status': status,
                    'created': env_data.get('created', 'Unknown'),
                    'project': env_data.get('project', 'general'),
                    'mode': env_data.get('mode', 'workspace'),
                    'ssh_host': env_data.get('ssh_host'),
                    'git_url': env_data.get('git_url'),
                    'stats': stats,
                    'url': f"http://{request.host.split(':')[0]}:{env_data['port']}"
                })
            except docker.errors.NotFound:
                # Container no longer exists
                pass
    
    return render_template('index.html', environments=environments)

@app.route('/api/environments')
def api_environments():
    """API endpoint for environment list"""
    registry = load_registry()
    environments = []
    
    if client:
        for env_id, env_data in registry.items():
            try:
                container = client.containers.get(env_data['container_id'])
                environments.append({
                    'name': env_data.get('display_name', env_id),
                    'id': env_id,
                    'port': env_data['port'],
                    'status': container.status,
                    'url': f"http://{request.host.split(':')[0]}:{env_data['port']}"
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
    git_url = data.get('git_url', '')
    
    if not client:
        return jsonify({'error': 'Docker not available'}), 500
    
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
        elif mode == 'git':
            env_vars['GIT_URL'] = git_url
        
        container = client.containers.run(
            'dev-farm/code-server:latest',
            name=f"devfarm-{env_id}",
            detach=True,
            ports={'8080/tcp': port},  # Map container's internal 8080 to host's external port
            volumes={
                f'devfarm-{env_id}': {'bind': '/home/coder/workspace', 'mode': 'rw'}
            },
            environment=env_vars,
            labels={
                'dev-farm': 'true',
                'dev-farm.id': env_id,
                'dev-farm.name': display_name,
                'dev-farm.project': project,
                'dev-farm.mode': mode
            }
        )
        
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
            'git_url': git_url if mode == 'git' else None
        }
        save_registry(registry)
        
        return jsonify({
            'success': True,
            'name': display_name,
            'id': env_id,
            'port': port,
            'url': f"http://{request.host.split(':')[0]}:{port}"
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
        container = client.containers.get(registry[env_name]['container_id'])
        container.stop()
        container.remove()
        
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
                'expires_in': data['expires_in']
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
            return jsonify({'status': 'no_flow', 'message': 'No OAuth flow in progress'})
        
        with open(DEVICE_CODE_FILE, 'r') as f:
            device_data = json.load(f)
        
        # Check if expired
        if time.time() - device_data['started_at'] > device_data['expires_in']:
            os.remove(DEVICE_CODE_FILE)
            return jsonify({'status': 'expired'})
        
        # Poll GitHub for token
        response = requests.post(
            'https://github.com/login/oauth/access_token',
            headers={'Accept': 'application/json'},
            data={
                'client_id': 'Iv1.b507a08c87ecfe98',
                'device_code': device_data['device_code'],
                'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            
            if 'access_token' in result:
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
                    return jsonify({
                        'status': 'success',
                        'username': user_data.get('login')
                    })
                else:
                    return jsonify({'status': 'success'})
            
            elif result.get('error') == 'authorization_pending':
                return jsonify({'status': 'pending'})
            
            elif result.get('error') == 'slow_down':
                return jsonify({'status': 'slow_down'})
            
            elif result.get('error') == 'expired_token':
                os.remove(DEVICE_CODE_FILE)
                return jsonify({'status': 'expired'})
            
            elif result.get('error') == 'access_denied':
                os.remove(DEVICE_CODE_FILE)
                return jsonify({'status': 'denied'})
            
            else:
                return jsonify({'status': 'error', 'message': result.get('error_description', 'Unknown error')})
        
        return jsonify({'status': 'error', 'message': 'Failed to poll'}), 500
    except Exception as e:
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
        return jsonify({
            'docker_connected': client is not None,
            'environments': len(load_registry()),
            'updates_available': False,  # Can't check updates from inside container
            'commits_behind': 0
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

@app.route('/api/system/update', methods=['POST'])
def system_update():
    """Pull latest code from GitHub and restart services"""
    try:
        result = {'stages': []}
        
        # Stage 1: Git pull
        result['stages'].append({'stage': 'git_pull', 'status': 'starting'})
        
        github_token = load_github_token()
        if not github_token:
            return jsonify({'error': 'GitHub token not configured. Please authenticate first.'}), 401
        
        # Configure git to use token
        git_url = f'https://{github_token}@github.com/bustinjailey/dev-farm.git'
        
        # Change to repo directory and pull
        os.chdir(REPO_PATH)
        
        # Ensure we're on main branch
        subprocess.run(['git', 'fetch', 'origin'], check=True, capture_output=True)
        subprocess.run(['git', 'checkout', 'main'], check=True, capture_output=True)
        
        # Pull latest changes
        pull_result = subprocess.run(
            ['git', 'pull', 'origin', 'main'],
            check=True,
            capture_output=True,
            text=True
        )
        
        result['stages'].append({
            'stage': 'git_pull',
            'status': 'success',
            'message': pull_result.stdout.strip()
        })
        
        # Stage 2: Rebuild code-server image if Dockerfile changed
        result['stages'].append({'stage': 'rebuild_image', 'status': 'starting'})
        
        # Check if Dockerfile was modified
        diff_result = subprocess.run(
            ['git', 'diff', 'HEAD@{1}', 'HEAD', '--name-only'],
            capture_output=True,
            text=True
        )
        
        files_changed = diff_result.stdout.split('\n')
        dockerfile_changed = any('Dockerfile' in f for f in files_changed)
        
        if dockerfile_changed:
            build_result = subprocess.run(
                ['docker', 'build', '--no-cache', '-t', 'dev-farm/code-server:latest',
                 '-f', 'docker/Dockerfile.code-server', '.'],
                check=True,
                capture_output=True,
                text=True,
                cwd=REPO_PATH
            )
            result['stages'].append({
                'stage': 'rebuild_image',
                'status': 'success',
                'message': 'Image rebuilt successfully'
            })
        else:
            result['stages'].append({
                'stage': 'rebuild_image',
                'status': 'skipped',
                'message': 'No Dockerfile changes detected'
            })
        
        # Stage 3: Restart dashboard
        result['stages'].append({'stage': 'restart_dashboard', 'status': 'starting'})
        
        # Trigger restart using docker-compose
        subprocess.Popen(
            ['docker', 'compose', 'restart', 'dashboard'],
            cwd=REPO_PATH,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        
        result['stages'].append({
            'stage': 'restart_dashboard',
            'status': 'success',
            'message': 'Dashboard restarting...'
        })
        
        result['success'] = True
        result['message'] = 'Update completed successfully. Dashboard will restart momentarily.'
        
        return jsonify(result)
        
    except subprocess.CalledProcessError as e:
        return jsonify({
            'error': f'Command failed: {e.cmd}',
            'output': e.stdout if e.stdout else e.stderr,
            'stages': result.get('stages', [])
        }), 500
    except Exception as e:
        return jsonify({
            'error': str(e),
            'stages': result.get('stages', [])
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('DEBUG', 'false').lower() == 'true')
