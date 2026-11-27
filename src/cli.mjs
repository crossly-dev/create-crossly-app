import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { relative } from 'node:path';
import { scaffold } from './scaffold.mjs';
import { detectPackageManager, findTemplate, PACKAGE_MANAGERS, pmCommands, TEMPLATES, TEMPLATE_NAMES } from './templates.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const color = (code) => (s) => (process.env.NO_COLOR || !process.stdout.isTTY ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = color(1);
const dim = color(2);
const cyan = color(36);
const green = color(32);

export function usage() {
  return `${bold('create-crossly-app')} ${VERSION}: start a Crossly integration in one command

Usage
  npx create-crossly-app [dir] [options]
  npm create crossly-app@latest [dir] -- [options]

Options
  -t, --template <name>   One of: ${TEMPLATE_NAMES.join(', ')}
      --pm <name>         Package manager: ${PACKAGE_MANAGERS.join(', ')} (default: the one running this)
  -y, --yes               Don't ask: use the flags, defaults for the rest (needs --template)
      --install           Install dependencies after scaffolding
      --no-install        Don't install (the default with --yes)
      --list              List the templates
  -h, --help              Show this help
  -v, --version           Print the version

Templates
${TEMPLATES.map((t) => `  ${cyan(t.name.padEnd(22))}${t.description}`).join('\n')}

Examples
  npx create-crossly-app my-shop
  npx create-crossly-app hooks --template webhook-express --yes
  pnpm create crossly-app bot --template seller-bot --pm pnpm --install
`;
}

export function parseArgs(argv) {
  const opts = { dir: undefined, template: undefined, pm: undefined, yes: false, install: undefined, help: false, version: false, list: false };
  const take = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) throw new Error(`${flag} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    switch (flag) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '--list':
        opts.list = true;
        break;
      case '-y':
      case '--yes':
        opts.yes = true;
        break;
      case '--install':
        opts.install = true;
        break;
      case '--no-install':
      case '--skip-install':
        opts.install = false;
        break;
      case '-t':
      case '--template':
        opts.template = inline ?? take(i, flag);
        if (inline === undefined) i += 1;
        break;
      case '--pm':
      case '--package-manager':
        opts.pm = inline ?? take(i, flag);
        if (inline === undefined) i += 1;
        break;
      case '--use-npm':
      case '--use-pnpm':
      case '--use-yarn':
      case '--use-bun':
        opts.pm = flag.slice('--use-'.length);
        break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option ${a}. Run with --help to see the options.`);
        if (opts.dir !== undefined) throw new Error(`Unexpected argument "${a}": give one project directory.`);
        opts.dir = a;
    }
  }
  if (opts.template !== undefined && !findTemplate(opts.template)) {
    throw new Error(`Unknown template "${opts.template}". Valid templates: ${TEMPLATE_NAMES.join(', ')}`);
  }
  if (opts.pm !== undefined && !PACKAGE_MANAGERS.includes(opts.pm)) {
    throw new Error(`Unknown package manager "${opts.pm}". Use one of: ${PACKAGE_MANAGERS.join(', ')}`);
  }
  return opts;
}

/** Line-buffered prompts that also work with piped input (answers written before the question is asked). */
function createPrompter(input, output) {
  const rl = createInterface({ input, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question) => {
    output.write(question);
    const { value, done } = await lines.next();
    if (done) throw new Error('Input ended before every question was answered. Use --yes with flags for non-interactive runs.');
    return String(value).trim();
  };
  return {
    async text(label, fallback) {
      const answer = await ask(`${bold('?')} ${label} ${dim(`(${fallback})`)} `);
      return answer || fallback;
    },
    async select(label, choices, fallbackIndex = 0) {
      output.write(`${bold('?')} ${label}\n`);
      choices.forEach((c, i) => output.write(`  ${cyan(String(i + 1).padStart(2))}) ${c.label}${c.hint ? dim(`  ${c.hint}`) : ''}\n`));
      for (;;) {
        const answer = await ask(`  ${dim(`Choose 1-${choices.length}`)} ${dim(`(${fallbackIndex + 1})`)} `);
        if (!answer) return choices[fallbackIndex].value;
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;
        const byName = choices.find((c) => c.value === answer);
        if (byName) return byName.value;
        output.write(`  Please enter a number from 1 to ${choices.length}.\n`);
      }
    },
    async confirm(label, fallback) {
      for (;;) {
        const answer = (await ask(`${bold('?')} ${label} ${dim(fallback ? '(Y/n)' : '(y/N)')} `)).toLowerCase();
        if (!answer) return fallback;
        if (['y', 'yes'].includes(answer)) return true;
        if (['n', 'no'].includes(answer)) return false;
      }
    },
    close() {
      rl.close();
    },
  };
}

function nextSteps({ dir, template, pm, installed }) {
  const t = findTemplate(template);
  const c = pmCommands(pm);
  const steps = [];
  if (dir !== '.') steps.push(`cd ${dir.includes(' ') ? `"${dir}"` : dir}`);
  if (!installed) steps.push(c.install);
  steps.push(`cp .env.example ${t.envFile}   ${dim(`# then set ${t.env.join(', ')}`)}`);
  steps.push(c.run(t.run));
  return steps;
}

/**
 * Run the CLI. Returns the process exit code.
 * `io` is injectable for tests: { input, output, error, interactive, env, spawn }.
 */
export async function run(argv, io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const error = io.error ?? process.stderr;
  const env = io.env ?? process.env;
  const spawn = io.spawn ?? spawnSync;

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    error.write(`Error: ${e.message}\n`);
    return 1;
  }
  if (opts.help) {
    output.write(usage());
    return 0;
  }
  if (opts.version) {
    output.write(`${VERSION}\n`);
    return 0;
  }
  if (opts.list) {
    for (const t of TEMPLATES) output.write(`${t.name}\t${t.description}\n`);
    return 0;
  }

  const interactive = io.interactive ?? (!opts.yes && Boolean(input.isTTY));
  if (!interactive && !opts.template) {
    error.write(
      `Error: --template is required when not running interactively.\nValid templates: ${TEMPLATE_NAMES.join(', ')}\n` +
        `Example: create-crossly-app my-app --template webhook-express --yes\n`,
    );
    return 1;
  }

  let { dir, template, pm, install } = opts;
  const detected = detectPackageManager(env);

  if (interactive) {
    output.write(`\n${bold('create-crossly-app')} ${dim(VERSION)}\n\n`);
    const prompt = createPrompter(input, output);
    try {
      if (!dir) dir = await prompt.text('Project directory:', 'crossly-app');
      if (!template) {
        template = await prompt.select(
          'Which template?',
          TEMPLATES.map((t) => ({ value: t.name, label: t.title, hint: t.name })),
        );
      }
      if (!pm) {
        const order = [detected, ...PACKAGE_MANAGERS.filter((p) => p !== detected)];
        pm = await prompt.select(
          'Package manager:',
          order.map((p) => ({ value: p, label: p, hint: p === detected ? 'detected' : '' })),
        );
      }
      if (install === undefined) install = await prompt.confirm(`Install dependencies with ${pm} now?`, true);
    } catch (e) {
      error.write(`\nError: ${e.message}\n`);
      return 1;
    } finally {
      prompt.close();
    }
  }

  dir = dir ?? 'crossly-app';
  pm = pm ?? detected;
  install = install ?? false;

  let result;
  try {
    result = scaffold({ dir, template, packageManager: pm });
  } catch (e) {
    error.write(`Error: ${e.message}\n`);
    return 1;
  }

  const shown = relative(process.cwd(), result.target) || '.';
  output.write(`\n${green('✔')} Created ${bold(shown)} from ${cyan(template)}, with .env.example\n`);

  let installed = false;
  if (install) {
    output.write(`\nInstalling dependencies with ${pm}…\n`);
    const r = spawn(pm, ['install'], { cwd: result.target, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status === 0) installed = true;
    else error.write(`\n${pm} install failed (exit ${r.status ?? r.error?.message}). The project is there; run it yourself.\n`);
  }

  output.write(`\nNext steps:\n${nextSteps({ dir: shown, template, pm, installed }).map((s) => `  ${s}`).join('\n')}\n`);
  output.write(`\nREADME.md in the project explains the rest. Docs: https://crossly.net/docs\n`);
  return 0;
}
