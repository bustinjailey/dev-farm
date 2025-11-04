import { spawn } from 'child_process';
import { chromium } from 'playwright';

const env = {
  ...process.env,
  PORT: '5050',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'warn',
};

const server = spawn('node', ['dist/server/main.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env,
  stdio: 'inherit',
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let code = 0;

try {
  await wait(1500);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => {
    console.log(`[console:${msg.type()}]`, msg.text());
  });
  page.on('pageerror', (err) => {
    console.error('[pageerror]', err);
    code = 1;
  });
  await page.goto('http://127.0.0.1:5050', { waitUntil: 'networkidle' });
  await wait(1000);
  await browser.close();
} catch (error) {
  console.error('[smoke]', error);
  code = 1;
} finally {
  server.kill('SIGTERM');
  await wait(500);
  process.exit(code);
}
