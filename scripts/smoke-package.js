const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  assert(process.argv[2], 'Usage: npm run test:package -- /path/to/package.tgz');
  const archive = path.resolve(process.argv[2]);
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  for (const entry of entries) {
    assert(!entry.split('/').includes('..'), `Unsafe archive entry: ${entry}`);
    assert(
      /^package\/(?:package\.json|README\.md|server\.js|src\/.+\.js|views\/.+\.ejs|public\/css\/.+\.css|public\/js\/.+\.js)$/.test(entry),
      `Unexpected file in package: ${entry}`
    );
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-package-'));
  let child;
  let output = '';
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temp]);
    const packageDir = path.join(temp, 'package');
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const source = require('../package.json');
    assert.equal(manifest.name, source.name);
    assert.equal(manifest.version, source.version);
    assert(!fs.existsSync(path.join(packageDir, 'data')), 'Package must not contain runtime data');
    assert(!fs.existsSync(path.join(packageDir, 'public', 'uploads')), 'Package must not contain uploads');

    for (const entry of entries.filter((name) => name.endsWith('.js'))) {
      execFileSync(process.execPath, ['--check', path.join(temp, entry)]);
    }
    // Use the dependencies installed by npm ci while running only packaged application files.
    fs.symlinkSync(path.resolve(__dirname, '..', 'node_modules'), path.join(packageDir, 'node_modules'), 'junction');
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const { port } = reservation.address();
    await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

    child = spawn(process.execPath, ['server.js'], {
      cwd: packageDir,
      env: { ...process.env, PORT: String(port), SESSION_SECRET: 'package-smoke-test-only' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    let spawnError;
    child.on('error', (error) => { spawnError = error; });
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Packaged server exited: ${output}`);
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        ready = response.ok;
        await response.text();
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert(ready, `Packaged server did not become ready: ${output}`);

    for (const route of ['/', '/auth', '/categories', '/reviews', '/media', '/search', '/profile/aurora_admin', '/about', '/contact', '/affiliates', '/help']) {
      const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `${route} should load`);
      assert.match(await response.text(), /Prism Forum/, `${route} should render a page`);
    }
    for (const route of ['/css/styles.css', '/js/app.js']) {
      const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `${route} should be included`);
      assert((await response.text()).length > 0);
    }
    const response = await fetch(`${origin}/api/search?q=aurora`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const results = await response.json();
    assert(Array.isArray(results.results) && results.results.length > 0, 'Search should find seeded content');
    assert(fs.existsSync(path.join(packageDir, 'data', 'forum.db')), 'App should initialize its database');
    assert(fs.existsSync(path.join(packageDir, 'public', 'uploads')), 'App should initialize uploads');
    console.log(`Verified ${manifest.name}@${manifest.version}: ${entries.length} package files, 11 pages, static assets, database initialization, and search.`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
