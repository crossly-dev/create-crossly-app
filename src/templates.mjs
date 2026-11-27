// What each template is, what it needs, and how to run it. The CLI's prompts,
// --help, --list and "next steps" all read this, and CI scaffolds every entry.

export const TEMPLATES = [
  {
    name: 'storefront-next',
    title: 'Storefront (Next.js)',
    description: 'Next.js App Router shop: your Crossly catalog with buy buttons, via @crossly/embed and a publishable key.',
    envFile: '.env.local',
    env: ['NEXT_PUBLIC_CROSSLY_PK'],
    run: 'dev',
  },
  {
    name: 'webhook-express',
    title: 'Webhook receiver (Express)',
    description: 'Express server that verifies Crossly-Signature over the raw body and switches on typed events.',
    envFile: '.env',
    env: ['CROSSLY_WEBHOOK_SECRET'],
    run: 'dev',
  },
  {
    name: 'webhook-hono-workers',
    title: 'Webhook receiver (Hono on Cloudflare Workers)',
    description: 'Hono on Cloudflare Workers with wrangler: the same verification at the edge.',
    envFile: '.dev.vars',
    env: ['CROSSLY_WEBHOOK_SECRET'],
    run: 'dev',
  },
  {
    name: 'seller-bot',
    title: 'Seller bot (Node)',
    description: 'Posts new sales to a Slack or Discord webhook and runs a scheduled price drop on stale listings, with @crossly/sdk.',
    envFile: '.env',
    env: ['CROSSLY_PAT', 'NOTIFY_WEBHOOK_URL'],
    run: 'start',
  },
  {
    name: 'oauth-app',
    title: 'Sign in with Crossly (OAuth app)',
    description: 'A third-party app doing OAuth 2.0 + PKCE against crossly.net/atlas, then calling the API for the seller.',
    envFile: '.env',
    env: ['CROSSLY_CLIENT_ID', 'CROSSLY_CLIENT_SECRET'],
    run: 'dev',
  },
];

export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);

export function findTemplate(name) {
  return TEMPLATES.find((t) => t.name === name);
}

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

/** Commands per package manager, for READMEs and the next-steps message. */
export function pmCommands(pm) {
  switch (pm) {
    case 'pnpm':
      return { install: 'pnpm install', run: (s) => `pnpm ${s}`, exec: 'pnpm exec', dlx: 'pnpm dlx', add: 'pnpm add' };
    case 'yarn':
      return { install: 'yarn', run: (s) => `yarn ${s}`, exec: 'yarn', dlx: 'npx', add: 'yarn add' };
    case 'bun':
      return { install: 'bun install', run: (s) => `bun run ${s}`, exec: 'bunx', dlx: 'bunx', add: 'bun add' };
    default:
      return { install: 'npm install', run: (s) => (s === 'start' || s === 'test' ? `npm ${s}` : `npm run ${s}`), exec: 'npx', dlx: 'npx', add: 'npm install' };
  }
}

/** The package manager that ran us (`npm create`, `pnpm create`, `yarn create`, `bun create`), if any. */
export function detectPackageManager(env = process.env) {
  const ua = env.npm_config_user_agent ?? '';
  for (const pm of ['pnpm', 'yarn', 'bun']) if (ua.startsWith(`${pm}/`)) return pm;
  return 'npm';
}
