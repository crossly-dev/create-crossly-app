import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTemplate, pmCommands, TEMPLATE_NAMES } from './templates.mjs';

export const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

// npm never packs a file named .gitignore, and dotfiles like .env.example are easy
// to lose to ignore rules, so templates ship them under a leading underscore and
// they are renamed here.
const RENAMES = {
  _package: 'package.json',
  '_package.json': 'package.json',
  _gitignore: '.gitignore',
  '_env.example': '.env.example',
  _npmrc: '.npmrc',
};

const TEXT_EXT = /\.(json|jsonc|md|ts|tsx|mts|mjs|js|cjs|css|html|toml|example|yml|yaml|txt)$|^(_gitignore|_npmrc|\.gitignore)$/;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** An npm-valid package name from a directory name: `My Shop!` -> `my-shop`. */
export function toPackageName(dir) {
  const name = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[._-]+|[-]+$/g, '')
    .slice(0, 214);
  return name || 'crossly-app';
}

/** A Cloudflare Worker name: lowercase letters, digits and dashes, at most 63 characters. */
export function toWorkerName(name) {
  return name.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'crossly-webhooks';
}

export function isEmptyDir(dir) {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).every((f) => f === '.git' || f === '.DS_Store');
}

/**
 * Copy a template into `dir` and fill in its placeholders.
 * Refuses a non-empty directory and writes nothing in that case.
 */
export function scaffold({ dir, template, packageManager = 'npm' }) {
  if (!template || !findTemplate(template)) {
    throw new Error(`Unknown template "${template ?? ''}". Valid templates: ${TEMPLATE_NAMES.join(', ')}`);
  }
  if (!dir) throw new Error('Missing the project directory, e.g. `create-crossly-app my-app`.');
  const target = resolve(dir);
  if (!isEmptyDir(target)) {
    throw new Error(`${target} is not empty; refusing to overwrite it. Pick a new directory.`);
  }

  mkdirSync(target, { recursive: true });
  cpSync(join(TEMPLATES_DIR, template), target, { recursive: true });

  for (const file of walk(target)) {
    const renamed = RENAMES[basename(file)];
    if (renamed) renameSync(file, join(dirname(file), renamed));
  }

  const name = toPackageName(dir);
  const pm = pmCommands(packageManager);
  const replacements = {
    __APP_NAME__: name,
    __WORKER_NAME__: toWorkerName(name),
    __PM_INSTALL__: pm.install,
    __PM_DEV__: pm.run('dev'),
    __PM_START__: pm.run('start'),
    __PM_BUILD__: pm.run('build'),
    __PM_TEST__: pm.run('test'),
    __PM_TYPECHECK__: pm.run('typecheck'),
    __PM_DEPLOY__: pm.run('deploy'),
    __PM_EXEC__: pm.exec,
    __PM_DLX__: pm.dlx,
    __PM_RUN__: pm.run('').trimEnd(),
    __PACKAGE_MANAGER__: packageManager,
  };
  for (const file of walk(target)) {
    if (!TEXT_EXT.test(basename(file))) continue;
    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const [key, value] of Object.entries(replacements)) after = after.split(key).join(value);
    if (after !== before) writeFileSync(file, after);
  }
  // Templates keep a real, valid package.json (so Dependabot can keep their
  // dependencies current); the project name is set here.
  const manifestPath = join(target, 'package.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.name = name;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { target, name };
}
