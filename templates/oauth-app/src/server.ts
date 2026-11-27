import { createServer } from 'node:http';
import { createApp, type AppConfig } from './app.js';

try {
  process.loadEnvFile();
} catch {
  /* no .env */
}

const env = process.env;
const clientId = env.CROSSLY_CLIENT_ID?.trim();
if (!clientId) {
  console.error('CROSSLY_CLIENT_ID is not set. Register an app in Crossly under Settings → API & webhooks → OAuth apps,');
  console.error('add http://localhost:3000/callback as a redirect URI, and copy its client id (and secret) into .env.');
  process.exit(1);
}

const config: AppConfig = {
  issuer: env.CROSSLY_ISSUER?.trim() || 'https://crossly.net/atlas',
  clientId,
  clientSecret: env.CROSSLY_CLIENT_SECRET?.trim() || undefined,
  redirectUri: env.CROSSLY_REDIRECT_URI?.trim() || 'http://localhost:3000/callback',
  resource: env.CROSSLY_RESOURCE?.trim() || 'https://crossly.net/api/v1',
  scopes: (env.CROSSLY_SCOPES?.trim() || 'offline_access listings:read').split(/[\s,]+/).filter(Boolean),
  apiBase: env.CROSSLY_API_BASE?.trim() || 'https://crossly.net/api',
};

const port = Number(env.PORT ?? new URL(config.redirectUri).port ?? 3000) || 3000;
createServer(createApp(config)).listen(port, () => {
  console.info(`Open http://localhost:${port} (${config.clientSecret ? 'confidential' : 'public'} client ${clientId})`);
});
