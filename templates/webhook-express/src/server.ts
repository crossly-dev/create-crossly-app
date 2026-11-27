import { createApp } from './app.js';

// Node 20.12+ reads .env without a dependency. A missing file is fine in production.
try {
  process.loadEnvFile();
} catch {
  /* no .env */
}

const secret = process.env.CROSSLY_WEBHOOK_SECRET;
if (!secret) {
  console.error('CROSSLY_WEBHOOK_SECRET is not set. Copy .env.example to .env and paste the signing secret from');
  console.error('Settings → API & webhooks → Webhooks (it is shown once, when you add the endpoint).');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
createApp({ secret }).listen(port, () => {
  console.info(`Listening on http://localhost:${port}/webhooks/crossly`);
});
