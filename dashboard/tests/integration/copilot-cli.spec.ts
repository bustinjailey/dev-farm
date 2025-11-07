import { test, expect } from '@playwright/test';
import Docker from 'dockerode';

test.describe('Copilot CLI Installation', () => {
  let docker: Docker;
  let testEnvId: string;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test('creates terminal environment and verifies copilot CLI is installed', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // Open create modal
    const createButton = page.locator('button:has-text("+ Create")');
    await createButton.click();

    // Fill in the form for terminal mode
    testEnvId = `copilot-test-${Date.now()}`;
    await page.fill('input[placeholder="My Project"]', testEnvId);
    
    // Select terminal mode
    const terminalRadio = page.locator('input[type="radio"][value="terminal"]');
    await terminalRadio.click();

    // Submit form
    const submitButton = page.locator('button:has-text("Create Environment")');
    await submitButton.click();

    // Wait for modal to close
    await expect(page.locator('h2:has-text("Create New Environment")')).not.toBeVisible({ timeout: 2000 });

    // Wait for environment card to appear
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 5000 });

    // Wait for container to be running (up to 2 minutes)
    let containerRunning = false;
    let container;
    
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);
      
      // Check container status
      const containers = await docker.listContainers({ all: true });
      container = containers.find(c => c.Names.some(n => n.includes(testEnvId.replace(/[^a-z0-9-]/gi, '-').toLowerCase())));
      
      if (container && container.State === 'running') {
        containerRunning = true;
        break;
      }
    }

    expect(containerRunning).toBeTruthy();

    if (!container) {
      throw new Error('Container not found');
    }

    // Get the actual container name
    const containerName = container.Names[0].replace(/^\//, '');
    console.log('Container name:', containerName);

    // Exec into container and check copilot installation
    const containerInstance = docker.getContainer(container.Id);
    
    // Wait a bit for startup script to complete
    await page.waitForTimeout(10000);

    // Check if copilot command exists
    const execWhich = await containerInstance.exec({
      Cmd: ['bash', '-c', 'which copilot'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamWhich = await execWhich.start({ Detach: false });
    let whichOutput = '';
    
    streamWhich.on('data', (chunk: Buffer) => {
      whichOutput += chunk.toString();
    });

    await new Promise((resolve) => streamWhich.on('end', resolve));
    
    console.log('which copilot output:', whichOutput);

    // Check PATH
    const execPath = await containerInstance.exec({
      Cmd: ['bash', '-c', 'echo $PATH'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamPath = await execPath.start({ Detach: false });
    let pathOutput = '';
    
    streamPath.on('data', (chunk: Buffer) => {
      pathOutput += chunk.toString();
    });

    await new Promise((resolve) => streamPath.on('end', resolve));
    
    console.log('PATH:', pathOutput);

    // Check npm global location
    const execNpmRoot = await containerInstance.exec({
      Cmd: ['bash', '-c', 'npm root -g'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamNpmRoot = await execNpmRoot.start({ Detach: false });
    let npmRootOutput = '';
    
    streamNpmRoot.on('data', (chunk: Buffer) => {
      npmRootOutput += chunk.toString();
    });

    await new Promise((resolve) => streamNpmRoot.on('end', resolve));
    
    console.log('npm root -g:', npmRootOutput);

    // Check if copilot is installed in npm global
    const execNpmList = await containerInstance.exec({
      Cmd: ['bash', '-c', 'npm list -g --depth=0 2>&1 | grep copilot'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamNpmList = await execNpmList.start({ Detach: false });
    let npmListOutput = '';
    
    streamNpmList.on('data', (chunk: Buffer) => {
      npmListOutput += chunk.toString();
    });

    await new Promise((resolve) => streamNpmList.on('end', resolve));
    
    console.log('npm list copilot:', npmListOutput);

    // Check startup log
    const execLog = await containerInstance.exec({
      Cmd: ['bash', '-c', 'tail -100 /home/coder/workspace/.devfarm/startup.log 2>&1 || echo "No log file"'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamLog = await execLog.start({ Detach: false });
    let logOutput = '';
    
    streamLog.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString();
    });

    await new Promise((resolve) => streamLog.on('end', resolve));
    
    console.log('Startup log (last 100 lines):\n', logOutput);

    // Try running copilot --version
    const execVersion = await containerInstance.exec({
      Cmd: ['bash', '-c', 'export PATH=/home/coder/.npm-global/bin:$PATH && copilot --version 2>&1'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamVersion = await execVersion.start({ Detach: false });
    let versionOutput = '';
    
    streamVersion.on('data', (chunk: Buffer) => {
      versionOutput += chunk.toString();
    });

    await new Promise((resolve) => streamVersion.on('end', resolve));
    
    console.log('copilot --version:', versionOutput);

    // Verify copilot is accessible
    expect(versionOutput).toContain('0.0.');
  });

  test.afterAll(async () => {
    // Cleanup: remove test container
    if (testEnvId) {
      try {
        const containers = await docker.listContainers({ all: true });
        const container = containers.find(c => 
          c.Names.some(n => n.includes(testEnvId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()))
        );
        
        if (container) {
          const containerInstance = docker.getContainer(container.Id);
          await containerInstance.stop().catch(() => {});
          await containerInstance.remove().catch(() => {});
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });
});
