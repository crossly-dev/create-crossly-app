import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  authorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  OAuthError,
  randomToken,
  refreshTokens,
  revoke,
  userInfo,
  type ClientConfig,
  type Discovery,
  type TokenSet,
  type UserInfo,
} from './oauth.js';

export interface AppConfig extends ClientConfig {
  /** Base of the Crossly REST API, e.g. https://crossly.net/api (paths are /v1/...). */
  apiBase: string;
}

interface Session {
  user: UserInfo;
  accessToken: string;
  refreshToken?: string;
  /** ms epoch. */
  expiresAt: number;
  scope?: string;
}

interface PendingLogin {
  verifier: string;
  nonce: string;
  createdAt: number;
}

export interface ListingSummary {
  id: string;
  title: string | null;
  price: string | null;
  status: string;
}

const LOGIN_COOKIE = 'crossly_oauth_state';
const SESSION_COOKIE = 'crossly_session';
const LOGIN_TTL_MS = 10 * 60_000;

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --line: #8884; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
  .btn { display: inline-block; padding: 10px 16px; border-radius: 8px; background: #1f6feb; color: #fff; text-decoration: none; border: 0; font: inherit; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  code { font-size: 14px; }
</style></head><body>${body}</body></html>`;
}

export interface CreateAppOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/** The whole app as a Node request listener: `http.createServer(createApp(config))`. */
export function createApp(config: AppConfig, options: CreateAppOptions = {}): RequestListener {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const secureCookies = config.redirectUri.startsWith('https://');
  const pending = new Map<string, PendingLogin>();
  const sessions = new Map<string, Session>();
  let discovery: Promise<Discovery> | undefined;
  const getDiscovery = () => {
    discovery ??= discover(config.issuer, doFetch).catch((err: unknown) => {
      discovery = undefined; // retry next time
      throw err;
    });
    return discovery;
  };

  const cookie = (name: string, value: string, maxAgeSeconds: number) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureCookies ? '; Secure' : ''}`;

  const send = (res: ServerResponse, status: number, html: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(html);
  };
  const redirect = (res: ServerResponse, location: string, setCookie: string[] = []) => {
    res.writeHead(302, { location, 'cache-control': 'no-store', ...(setCookie.length ? { 'set-cookie': setCookie } : {}) });
    res.end();
  };

  /** A valid access token for the session, refreshing it when it is about to expire. */
  async function accessTokenFor(session: Session): Promise<string> {
    if (session.expiresAt - now() > 30_000 || !session.refreshToken) return session.accessToken;
    const d = await getDiscovery();
    const tokens = await refreshTokens(d, config, session.refreshToken, doFetch);
    applyTokens(session, tokens);
    return session.accessToken;
  }

  function applyTokens(session: Pick<Session, 'accessToken' | 'refreshToken' | 'expiresAt' | 'scope'>, tokens: TokenSet) {
    session.accessToken = tokens.access_token;
    if (tokens.refresh_token) session.refreshToken = tokens.refresh_token; // rotation: keep the new one
    session.expiresAt = now() + (tokens.expires_in ?? 3600) * 1000;
    session.scope = tokens.scope ?? session.scope;
  }

  /** Call the Crossly API as the seller. The access token is a JWT: send it as a Bearer token on /api/v1. */
  async function crosslyGet<T>(session: Session, path: string): Promise<T> {
    const res = await doFetch(`${config.apiBase.replace(/\/$/, '')}${path}`, {
      headers: { authorization: `Bearer ${await accessTokenFor(session)}`, accept: 'application/json' },
    });
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new OAuthError(body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? `API answered ${res.status}`, res.status);
    return body as T;
  }

  async function home(req: IncomingMessage, res: ServerResponse) {
    const session = sessions.get(cookies(req)[SESSION_COOKIE] ?? '');
    if (!session) {
      send(
        res,
        200,
        page(
          'Sign in with Crossly',
          `<h1>Sign in with Crossly</h1>
<p>This app asks your Crossly account for: <code>${escapeHtml(['openid', ...config.scopes].join(' '))}</code>.</p>
<p><a class="btn" href="/login">Sign in with Crossly</a></p>`,
        ),
      );
      return;
    }
    let listingsHtml: string;
    try {
      const { data } = await crosslyGet<{ data: ListingSummary[] }>(session, '/v1/listings?limit=5');
      listingsHtml = data.length
        ? `<table><tr><th>Listing</th><th>Price</th><th>Status</th></tr>${data
            .map((l) => `<tr><td>${escapeHtml(l.title ?? l.id)}</td><td>${escapeHtml(l.price ?? '')}</td><td>${escapeHtml(l.status)}</td></tr>`)
            .join('')}</table>`
        : '<p>No listings yet.</p>';
    } catch (err) {
      const e = err as OAuthError;
      listingsHtml = `<p>Could not read listings: ${escapeHtml(e.message)} <code>${escapeHtml(e.code)}</code></p>`;
    }
    const who = session.user.name ?? session.user.preferred_username ?? session.user.email ?? session.user.sub;
    send(
      res,
      200,
      page(
        'Signed in',
        `<h1>Hello, ${escapeHtml(who)}</h1>
<p>Granted scopes: <code>${escapeHtml(session.scope ?? '')}</code></p>
<h2>Your latest listings</h2>${listingsHtml}
<form method="post" action="/logout"><button class="btn" type="submit">Sign out</button></form>`,
      ),
    );
  }

  async function login(_req: IncomingMessage, res: ServerResponse) {
    const d = await getDiscovery();
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = createPkce();
    for (const [k, v] of pending) if (now() - v.createdAt > LOGIN_TTL_MS) pending.delete(k);
    pending.set(state, { verifier, nonce, createdAt: now() });
    redirect(res, authorizationUrl(d, config, { state, codeChallenge: challenge, nonce }), [cookie(LOGIN_COOKIE, state, LOGIN_TTL_MS / 1000)]);
  }

  async function callback(req: IncomingMessage, res: ServerResponse, url: URL) {
    const fail = (status: number, message: string) =>
      send(res, status, page('Sign-in failed', `<h1>Sign-in failed</h1><p>${escapeHtml(message)}</p><p><a href="/">Back</a></p>`));

    const d = await getDiscovery();
    const error = url.searchParams.get('error');
    if (error) return fail(400, `${error}: ${url.searchParams.get('error_description') ?? 'the authorization was not granted.'}`);

    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    // The state must match the cookie this browser got from /login: that is the CSRF protection.
    const expected = cookies(req)[LOGIN_COOKIE];
    const attempt = pending.get(state);
    if (!state || state !== expected || !attempt || now() - attempt.createdAt > LOGIN_TTL_MS) {
      return fail(400, 'The sign-in request expired or did not start in this browser. Try again.');
    }
    // RFC 9207: the server says who issued the code; refuse a code from anyone else (mix-up attacks).
    const iss = url.searchParams.get('iss');
    if (iss !== null && iss !== d.issuer) return fail(400, `Unexpected issuer ${iss}.`);
    if (!code) return fail(400, 'No authorization code in the callback.');
    pending.delete(state);

    let tokens: TokenSet;
    let user: UserInfo;
    try {
      tokens = await exchangeCode(d, config, { code, codeVerifier: attempt.verifier }, doFetch);
      user = await userInfo(d, tokens.access_token, doFetch);
    } catch (err) {
      const e = err as OAuthError;
      return fail(502, `${e.code}: ${e.message}`);
    }
    const sid = randomToken();
    const session = { user } as Session;
    applyTokens(session, tokens);
    sessions.set(sid, session);
    redirect(res, '/', [cookie(SESSION_COOKIE, sid, 30 * 86_400), cookie(LOGIN_COOKIE, '', 0)]);
  }

  async function logout(req: IncomingMessage, res: ServerResponse) {
    const sid = cookies(req)[SESSION_COOKIE] ?? '';
    const session = sessions.get(sid);
    sessions.delete(sid);
    if (session?.refreshToken) await revoke(await getDiscovery(), config, session.refreshToken, doFetch);
    redirect(res, '/', [cookie(SESSION_COOKIE, '', 0)]);
  }

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const handler =
      route === 'GET /' ? home(req, res)
      : route === 'GET /login' ? login(req, res)
      : new URL(config.redirectUri).pathname === url.pathname && req.method === 'GET' ? callback(req, res, url)
      : route === 'POST /logout' ? logout(req, res)
      : route === 'GET /healthz' ? Promise.resolve(void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'))
      : Promise.resolve(send(res, 404, page('Not found', '<h1>Not found</h1>')));
    handler.catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, page('Error', `<h1>Something went wrong</h1><p>${escapeHtml((err as Error).message)}</p>`));
    });
  };
}
