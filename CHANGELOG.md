# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.1.0] - 2026-11-27

### Added

- `create-crossly-app` CLI (`npx create-crossly-app`, `npm create crossly-app`): interactive prompts for directory, template, package manager and install; non-interactive `--template <name> --yes`, `--pm`, `--install`/`--no-install`, `--list`. Zero runtime dependencies, Node 20+.
- Templates, each a complete project with a README, `.env.example`, `.gitignore` and tests:
  - `storefront-next`: Next.js App Router storefront with server-rendered catalog cards and `<crossly-buy-button>`, plus the drop-in `<crossly-catalog>`, via `@crossly/embed` and a publishable key.
  - `webhook-express`: Express 5 receiver verifying `Crossly-Signature` over the raw body with `@crossly/sdk`, duplicate guard, typed switch over the published event catalog.
  - `webhook-hono-workers`: the same on Hono + Cloudflare Workers with wrangler.
  - `seller-bot`: new-sale alerts to Slack/Discord from `GET /v1/sales`, and a daily dry-run-first price drop on stale listings via `PATCH /v1/listings/{id}`.
  - `oauth-app`: Sign in with Crossly (OAuth 2.0 + PKCE against crossly.net/atlas), then the API as the seller.
- CI that scaffolds every template from the packed tarball with `npx --yes`, then installs, typechecks, builds and tests it (npm, plus pnpm for two templates), on every change and weekly.
- Release workflow: build provenance attestation on the tarball, npm publish with provenance (gated on `PUBLISH_NPM`), GitHub Release with checksums.

[0.1.0]: https://github.com/crossly-dev/create-crossly-app/releases/tag/v0.1.0
