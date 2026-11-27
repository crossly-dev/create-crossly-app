import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs, run } from '../src/cli.mjs';
import { scaffold, TEMPLATES_DIR, toPackageName, toWorkerName } from '../src/scaffold.mjs';
import { detectPackageManager, pmCommands, TEMPLATES, TEMPLATE_NAMES } from '../src/templates.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'cca-'));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

function capture() {
  const chunks = [];
  const stream = new PassThrough();
  stream.on('data', (c) => chunks.push(c));
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

describe('templates', () => {
  test('every template in the registry has a directory, and every directory is registered', () => {
    const dirs = readdirSync(TEMPLATES_DIR).filter((n) => statSync(join(TEMPLATES_DIR, n)).isDirectory()).sort();
    assert.deepEqual(dirs, [...TEMPLATE_NAMES].sort());
  });

  for (const t of TEMPLATES) {
    test(`${t.name}: a complete project (README, .env.example, test, scripts)`, () => {
      const dir = join(TEMPLATES_DIR, t.name);
      for (const f of ['README.md', 'package.json', '_env.example', '_gitignore']) assert.ok(existsSync(join(dir, f)), `${t.name}/${f}`);
      const tests = walk(dir).filter((f) => /\.test\.(ts|tsx|mjs)$/.test(f));
      assert.ok(tests.length > 0, `${t.name} has a test`);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      for (const s of ['typecheck', 'test', 'build', t.run]) assert.ok(pkg.scripts[s], `${t.name} has a "${s}" script`);
      const env = readFileSync(join(dir, '_env.example'), 'utf8');
      for (const v of t.env) assert.match(env, new RegExp(`^#?\\s*${v}=`, 'm'), `${t.name} .env.example documents ${v}`);
    });

    test(`${t.name}: scaffolds with every placeholder filled`, () => {
      const dir = join(tmp(), 'My Crossly App');
      const { target, name } = scaffold({ dir, template: t.name, packageManager: 'pnpm' });
      assert.equal(name, 'my-crossly-app');
      const files = walk(target);
      assert.ok(existsSync(join(target, 'package.json')));
      assert.ok(existsSync(join(target, '.env.example')));
      assert.ok(existsSync(join(target, '.gitignore')));
      assert.ok(!files.some((f) => /[\\/]_(gitignore|env\.example)$/.test(f)), 'no underscore files left');
      for (const f of files) {
        const leftover = readFileSync(f, 'utf8').match(/__[A-Z_]+__/);
        assert.equal(leftover, null, `${f} still has ${leftover?.[0]}`);
      }
      assert.equal(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name, 'my-crossly-app');
      assert.match(readFileSync(join(target, 'README.md'), 'utf8'), /pnpm install/);
      assert.match(readFileSync(join(target, '.gitignore'), 'utf8'), /^\.env/m, '.gitignore keeps secrets out of git');
    });
  }

  test('webhook-express and webhook-hono-workers ship the same event types', () => {
    const a = readFileSync(join(TEMPLATES_DIR, 'webhook-express/src/events.ts'), 'utf8');
    const b = readFileSync(join(TEMPLATES_DIR, 'webhook-hono-workers/src/events.ts'), 'utf8');
    assert.equal(a, b);
    assert.match(a, /'sale\.detected'/);
    assert.match(a, /'test\.ping'/);
  });

  test('the worker gets a valid Cloudflare name', () => {
    const { target } = scaffold({ dir: join(tmp(), 'Edge_Hooks.v2'), template: 'webhook-hono-workers' });
    assert.match(readFileSync(join(target, 'wrangler.jsonc'), 'utf8'), /"name": "edge-hooks-v2"/);
  });
});

describe('scaffold()', () => {
  test('refuses a non-empty directory and writes nothing', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'keep.txt'), 'x');
    assert.throws(() => scaffold({ dir, template: 'seller-bot' }), /not empty/);
    assert.deepEqual(readdirSync(dir), ['keep.txt']);
  });

  test('accepts a directory holding only .git', () => {
    const dir = tmp();
    mkdirSync(join(dir, '.git'));
    scaffold({ dir, template: 'seller-bot' });
    assert.ok(existsSync(join(dir, 'package.json')));
  });

  test('rejects an unknown template, naming the valid ones', () => {
    assert.throws(() => scaffold({ dir: join(tmp(), 'a'), template: 'nope' }), /storefront-next.*webhook-express/s);
  });

  test('names', () => {
    assert.equal(toPackageName('/x/My Shop!'), 'my-shop');
    assert.equal(toPackageName('/x/---'), 'crossly-app');
    assert.equal(toWorkerName('a.b_c'), 'a-b-c');
  });
});

describe('parseArgs()', () => {
  test('flags, short flags and --flag=value', () => {
    assert.deepEqual(parseArgs(['app', '-t', 'seller-bot', '--pm=pnpm', '-y', '--install']), {
      dir: 'app', template: 'seller-bot', pm: 'pnpm', yes: true, install: true, help: false, version: false, list: false,
    });
    assert.equal(parseArgs(['--use-bun']).pm, 'bun');
    assert.equal(parseArgs(['--no-install']).install, false);
  });

  test('rejects unknown flags, templates and package managers', () => {
    assert.throws(() => parseArgs(['--wat']), /Unknown option/);
    assert.throws(() => parseArgs(['--template', 'nope']), /Valid templates/);
    assert.throws(() => parseArgs(['--pm', 'deno']), /Unknown package manager/);
    assert.throws(() => parseArgs(['a', 'b']), /one project directory/);
    assert.throws(() => parseArgs(['--template']), /needs a value/);
  });
});

describe('run()', () => {
  test('non-interactive: --template --yes scaffolds without asking and without installing', async () => {
    const cwd = tmp();
    const out = capture();
    const spawned = [];
    const code = await run([join(cwd, 'hooks'), '--template', 'webhook-express', '--yes'], {
      output: out.stream,
      error: out.stream,
      interactive: false,
      env: {},
      spawn: (...a) => spawned.push(a),
    });
    assert.equal(code, 0);
    assert.ok(existsSync(join(cwd, 'hooks', 'src', 'app.ts')));
    assert.equal(spawned.length, 0);
    assert.match(out.text(), /Next steps:[\s\S]*npm install[\s\S]*cp \.env\.example \.env[\s\S]*npm run dev/);
  });

  test('non-interactive without --template fails and lists the templates', async () => {
    const err = capture();
    const code = await run(['x', '--yes'], { output: capture().stream, error: err.stream, interactive: false, env: {} });
    assert.equal(code, 1);
    for (const n of TEMPLATE_NAMES) assert.match(err.text(), new RegExp(n));
  });

  test('interactive: asks for directory, template, package manager and install, with piped answers', async () => {
    const cwd = tmp();
    const input = new PassThrough();
    // directory, template #4 (seller-bot), package manager #2, install? yes
    input.end(`${join(cwd, 'bot')}\n4\n2\ny\n`);
    const out = capture();
    const spawned = [];
    const code = await run([], {
      input,
      output: out.stream,
      error: out.stream,
      interactive: true,
      env: { npm_config_user_agent: 'npm/10.9.0 node/v22.0.0' },
      spawn: (cmd, args, opts) => {
        spawned.push([cmd, args, opts.cwd]);
        return { status: 0 };
      },
    });
    assert.equal(code, 0, out.text());
    assert.ok(existsSync(join(cwd, 'bot', 'src', 'price-drop.ts')));
    // npm was detected so it is listed first; #2 is pnpm.
    assert.deepEqual(spawned, [['pnpm', ['install'], join(cwd, 'bot')]]);
    assert.match(readFileSync(join(cwd, 'bot', 'README.md'), 'utf8'), /pnpm start/);
    assert.match(out.text(), /Which template\?/);
    assert.doesNotMatch(out.text(), /\bpnpm install\b.*\n.*cp \.env/, 'install is not repeated in next steps after installing');
  });

  test('interactive: re-asks on a bad choice and accepts defaults on empty answers', async () => {
    const cwd = tmp();
    const input = new PassThrough();
    input.end(`${join(cwd, 'shop')}\n99\nstorefront-next\n\n\n`);
    const out = capture();
    const code = await run([], { input, output: out.stream, error: out.stream, interactive: true, env: {}, spawn: () => ({ status: 0 }) });
    assert.equal(code, 0, out.text());
    assert.match(out.text(), /Please enter a number from 1 to 5/);
    assert.ok(existsSync(join(cwd, 'shop', 'app', 'page.tsx')));
  });

  test('interactive input that ends early fails cleanly', async () => {
    const input = new PassThrough();
    input.end('');
    const err = capture();
    const code = await run([], { input, output: capture().stream, error: err.stream, interactive: true, env: {} });
    assert.equal(code, 1);
    assert.match(err.text(), /Input ended/);
  });

  test('--help, --version and --list', async () => {
    const out = capture();
    assert.equal(await run(['--help'], { output: out.stream }), 0);
    for (const n of TEMPLATE_NAMES) assert.match(out.text(), new RegExp(n));
    const v = capture();
    assert.equal(await run(['--version'], { output: v.stream }), 0);
    assert.equal(v.text().trim(), JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
    const l = capture();
    assert.equal(await run(['--list'], { output: l.stream }), 0);
    assert.equal(l.text().trim().split('\n').length, TEMPLATES.length);
  });
});

describe('package managers', () => {
  test('detected from npm_config_user_agent', () => {
    assert.equal(detectPackageManager({ npm_config_user_agent: 'pnpm/9.12.0 npm/? node/v22' }), 'pnpm');
    assert.equal(detectPackageManager({ npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22' }), 'yarn');
    assert.equal(detectPackageManager({ npm_config_user_agent: 'bun/1.1.0' }), 'bun');
    assert.equal(detectPackageManager({}), 'npm');
  });

  test('commands', () => {
    assert.equal(pmCommands('npm').run('dev'), 'npm run dev');
    assert.equal(pmCommands('npm').run('start'), 'npm start');
    assert.equal(pmCommands('pnpm').run('dev'), 'pnpm dev');
    assert.equal(pmCommands('bun').run('dev'), 'bun run dev');
  });
});

describe('bin', () => {
  test('the published bin runs', () => {
    const r = spawnSync(process.execPath, [join(root, 'bin/create-crossly-app.mjs'), '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /create-crossly-app/);
  });

  test('package.json "files" ships the bin, src and templates', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const f of ['bin', 'src', 'templates']) assert.ok(pkg.files.includes(f));
    assert.equal(pkg.bin['create-crossly-app'], 'bin/create-crossly-app.mjs');
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'zero runtime dependencies');
  });
});
