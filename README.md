# create-crossly-app

[![ci](https://github.com/crossly-dev/create-crossly-app/actions/workflows/ci.yml/badge.svg)](https://github.com/crossly-dev/create-crossly-app/actions/workflows/ci.yml)
[![release](https://github.com/crossly-dev/create-crossly-app/actions/workflows/release.yml/badge.svg)](https://github.com/crossly-dev/create-crossly-app/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/create-crossly-app.svg)](https://www.npmjs.com/package/create-crossly-app)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Start a [Crossly](https://crossly.net) integration in one command. Every template is a complete project, with its own
README, a `.env.example` and tests, and CI scaffolds, installs, typechecks, builds and tests every one of them on each
change.

```sh
npx create-crossly-app my-app
# or
npm create crossly-app@latest my-app
pnpm create crossly-app my-app
yarn create crossly-app my-app
bun create crossly-app my-app
```

It asks for a directory, a template, a package manager, and whether to install. No prompts in scripts and CI:

```sh
npx create-crossly-app hooks --template webhook-express --yes
npx create-crossly-app bot -t seller-bot --pm pnpm --yes --install
```

## Templates

| Template | What you get | Credential |
|---|---|---|
| `storefront-next` | Next.js App Router shop: your catalog rendered on the server with a buy button per item, plus the drop-in `<crossly-catalog>` page, via [`@crossly/embed`](https://github.com/crossly-dev/crossly-embed). Crossly-hosted checkout. | Publishable key `crossly_pk_live_…` |
| `webhook-express` | Express 5 receiver: `Crossly-Signature` verified over the raw body with `@crossly/sdk`'s `verifyWebhook`, 400 on a bad signature, duplicate-delivery guard, a typed `switch` over the real event names. | Webhook signing secret |
| `webhook-hono-workers` | The same on Hono + Cloudflare Workers (wrangler), with the secret as a binding and work in `waitUntil`. | Webhook signing secret |
| `seller-bot` | Node bot on `@crossly/sdk`: posts new sales to a Slack or Discord incoming webhook, and runs a daily price drop on stale listings (floors respected, dry run first). | Personal access token `crossly_pat_…` |
| `oauth-app` | Sign in with Crossly: OAuth 2.0 + PKCE against `crossly.net/atlas` (authorize, token, userinfo, refresh rotation, revoke), then the API as the seller. No dependencies beyond tsx. | OAuth app client id (+ secret) |

Everything they call is a documented public endpoint: `/api/embed/v1/catalog` and `/checkout` (embed), `GET /v1/sales`,
`GET`/`PATCH /v1/listings` (seller bot), the Atlas endpoints from its discovery document (OAuth), and the webhook event
catalog at [crossly.net/docs/api-webhooks](https://crossly.net/docs/api-webhooks).

## Options

| | |
|---|---|
| `-t, --template <name>` | One of the templates above. |
| `--pm <npm\|pnpm\|yarn\|bun>` | Package manager for the install and the commands in the README. Default: the one that ran `create`. |
| `-y, --yes` | Don't prompt. Needs `--template`. |
| `--install` / `--no-install` | Install dependencies after scaffolding. Default: ask; off with `--yes`. |
| `--list` | Print the templates. |
| `-h, --help`, `-v, --version` | |

It refuses to write into a non-empty directory. Each project gets a `.env.example` listing exactly what it needs and a
`.gitignore` that keeps the real `.env` / `.dev.vars` out of git.

## Programmatic use

```js
import { scaffold } from 'create-crossly-app';
import { TEMPLATES } from 'create-crossly-app/templates';

scaffold({ dir: 'my-app', template: 'webhook-express', packageManager: 'pnpm' });
```

## Developing

Zero runtime dependencies; Node 20+.

```sh
npm test                 # node:test: registry, scaffolding, prompts (with piped answers), flags, the bin
```

Templates live in [`templates/`](templates) as real projects (Dependabot keeps their dependencies current). Files
that npm would drop from the tarball are stored as `_gitignore` and `_env.example` and renamed on scaffold; `__APP_NAME__`
and `__PM_*__` placeholders are filled in. [CI](.github/workflows/ci.yml) packs the CLI, scaffolds every template from
the tarball with `npx … --yes`, and runs each project's install, typecheck, build and tests (with npm, and pnpm for two of
them), weekly as well as on every change.

## Verifying what you install

Releases are built by [`release.yml`](.github/workflows/release.yml): the tarball attached to each GitHub Release carries
a signed build provenance attestation, and the npm package is published with provenance.

```sh
gh release download v0.1.0 -R crossly-dev/create-crossly-app
gh attestation verify create-crossly-app-0.1.0.tgz -R crossly-dev/create-crossly-app
```

## Links

- [Crossly API docs](https://crossly.net/docs) · [Authentication & scopes](https://crossly.net/docs/api-authentication) · [Webhooks](https://crossly.net/docs/api-webhooks)
- [`@crossly/sdk`](https://github.com/crossly-dev/crossly-sdk) · [`@crossly/embed`](https://github.com/crossly-dev/crossly-embed) · [`crossly-webhooks-js`](https://github.com/crossly-dev/crossly-webhooks-js) (one-line adapters for Express, Fastify, Hono, Next.js, Koa)
- Security issues: [private vulnerability reporting](https://github.com/crossly-dev/create-crossly-app/security/advisories/new)

## License

[MIT](LICENSE)
