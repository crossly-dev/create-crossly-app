import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppConfig } from '../src/app.js';
import { createPkce, s256 } from '../src/oauth.js';

/**
 * A stand-in for crossly.net: the Atlas authorization server (discovery, token,
 * userinfo, revoke) and GET /api/v1/listings, behaving as the docs describe:
 * PKCE S256 enforced, client_secret_basic, the resource parameter, rotating
 * refresh tokens, JWT-ish bearer tokens on the API.
 */
function fakeCrossly() {
  const codes = new Map<string, { challenge: string; redirectUri: string; scope: string }>();
  const tokenRequests: URLSearchParams[] = [];
  const revoked: string[] = [];
  let issued = 0;
  let base = '';

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const read = async () => {
      let s = '';
      for await (const chunk of req) s += chunk;
      return new URLSearchParams(s);
    };

    if (url.pathname === '/atlas/.well-known/openid-configuration') {
      return json(200, {
        issuer: `${base}/atlas`,
        authorization_endpoint: `${base}/atlas/oauth2/authorize`,
        token_endpoint: `${base}/atlas/oauth2/token`,
        userinfo_endpoint: `${base}/atlas/oauth2/userinfo`,
        revocation_endpoint: `${base}/atlas/oauth2/revoke`,
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.pathname === '/atlas/oauth2/token' && req.method === 'POST') {
      const form = await read();
      tokenRequests.push(form);
      if (req.headers.authorization !== `Basic ${Buffer.from('app_123:shh').toString('base64')}`) return json(401, { error: 'invalid_client' });
      if (form.get('resource') !== 'https://crossly.net/api/v1') return json(400, { error: 'invalid_target' });
      if (form.get('grant_type') === 'authorization_code') {
        const grant = codes.get(form.get('code') ?? '');
        if (!grant) return json(400, { error: 'invalid_grant' });
        if (s256(form.get('code_verifier') ?? '') !== grant.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        if (form.get('redirect_uri') !== grant.redirectUri) return json(400, { error: 'invalid_grant' });
        codes.delete(form.get('code')!);
        issued += 1;
        return json(200, { access_token: `eyJ.access.${issued}`, token_type: 'Bearer', expires_in: 3600, refresh_token: `rt_${issued}`, scope: grant.scope });
      }
      if (form.get('grant_type') === 'refresh_token') {
        issued += 1;
        return json(200, { access_token: `eyJ.access.${issued}`, token_type: 'Bearer', expires_in: 3600, refresh_token: `rt_${issued}`, scope: 'openid offline_access listings:read' });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/atlas/oauth2/userinfo') {
      if (!req.headers.authorization?.startsWith('Bearer eyJ.')) return json(401, {});
      return json(200, { sub: 'usr_1', email: 'seller@example.com', name: 'Sam Seller' });
    }
    if (url.pathname === '/atlas/oauth2/revoke' && req.method === 'POST') {
      revoked.push((await read()).get('token') ?? '');
      return json(200, {});
    }
    if (url.pathname === '/api/v1/listings') {
      if (!req.headers.authorization?.startsWith('Bearer eyJ.')) {
        return json(401, { error: { code: 'missing_authorization', message: 'Bearer token required.' }, correlationId: 'req-1' });
      }
      return json(200, { data: [{ id: 'lst_1', title: 'Vintage denim jacket', price: '84.00', status: 'active' }], pagination: { page: 1, limit: 5 } });
    }
    json(404, {});
  });

  return {
    server,
    codes,
    tokenRequests,
    revoked,
    setBase(b: string) {
      base = b;
    },
    /** What Crossly's consent screen does when the seller clicks Allow: mint a code for the request. */
    approve(authorizeUrl: string): { code: string; state: string; iss: string } {
      const u = new URL(authorizeUrl);
      const code = `code_${codes.size + 1}_${Date.now()}`;
      codes.set(code, { challenge: u.searchParams.get('code_challenge')!, redirectUri: u.searchParams.get('redirect_uri')!, scope: u.searchParams.get('scope')! });
      return { code, state: u.searchParams.get('state')!, iss: `${base}/atlas` };
    },
  };
}

const listen = (server: Server) =>
  new Promise<string>((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

let crossly: ReturnType<typeof fakeCrossly>;
let appServer: Server;
let app: string;
let clock = Date.now();

beforeAll(async () => {
  crossly = fakeCrossly();
  const base = await listen(crossly.server);
  crossly.setBase(base);
  appServer = createServer();
  app = await listen(appServer);
  const config: AppConfig = {
    issuer: `${base}/atlas`,
    clientId: 'app_123',
    clientSecret: 'shh',
    redirectUri: `${app}/callback`,
    resource: 'https://crossly.net/api/v1',
    scopes: ['offline_access', 'listings:read'],
    apiBase: `${base}/api`,
  };
  appServer.on('request', createApp(config, { now: () => clock }));
});

afterAll(() => {
  crossly.server.close();
  appServer.close();
});

const cookieFrom = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

async function signIn() {
  const login = await fetch(`${app}/login`, { redirect: 'manual' });
  const authorize = login.headers.get('location')!;
  const stateCookie = cookieFrom(login, 'crossly_oauth_state');
  const { code, state, iss } = crossly.approve(authorize);
  const cb = await fetch(`${app}/callback?code=${code}&state=${state}&iss=${encodeURIComponent(iss)}`, {
    redirect: 'manual',
    headers: { cookie: stateCookie },
  });
  return { login, authorize, stateCookie, cb, session: cookieFrom(cb, 'crossly_session') };
}

describe('Sign in with Crossly', () => {
  it('sends the seller to /atlas/oauth2/authorize with PKCE S256, openid, the API resource and a state cookie', async () => {
    const { login, authorize, stateCookie } = await signIn();
    expect(login.status).toBe(302);
    const u = new URL(authorize);
    expect(u.pathname).toBe('/atlas/oauth2/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('app_123');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('resource')).toBe('https://crossly.net/api/v1');
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(['openid', 'offline_access', 'listings:read']);
    expect(stateCookie).toBe(`crossly_oauth_state=${u.searchParams.get('state')}`);
    expect(login.headers.getSetCookie()[0]).toMatch(/HttpOnly; SameSite=Lax/);
  });

  it('exchanges the code with the verifier and Basic auth, then shows the seller and their listings', async () => {
    const { cb, session } = await signIn();
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/');
    const exchange = crossly.tokenRequests.at(-1)!;
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code_verifier')).toBeTruthy();
    expect(exchange.has('client_secret')).toBe(false);

    const home = await fetch(`${app}/`, { headers: { cookie: session } });
    const html = await home.text();
    expect(html).toContain('Hello, Sam Seller');
    expect(html).toContain('Vintage denim jacket');
  });

  it('refuses a callback whose state did not start in this browser (CSRF)', async () => {
    const login = await fetch(`${app}/login`, { redirect: 'manual' });
    const { code, state } = crossly.approve(login.headers.get('location')!);
    const res = await fetch(`${app}/callback?code=${code}&state=${state}`, { redirect: 'manual' });
    expect(res.status).toBe(400);
  });

  it('refuses a code from another issuer (RFC 9207 mix-up defence)', async () => {
    const login = await fetch(`${app}/login`, { redirect: 'manual' });
    const { code, state } = crossly.approve(login.headers.get('location')!);
    const res = await fetch(`${app}/callback?code=${code}&state=${state}&iss=${encodeURIComponent('https://evil.example')}`, {
      redirect: 'manual',
      headers: { cookie: cookieFrom(login, 'crossly_oauth_state') },
    });
    expect(res.status).toBe(400);
  });

  it('shows the error the seller chose (access_denied) instead of crashing', async () => {
    const res = await fetch(`${app}/callback?error=access_denied&error_description=The+seller+declined`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('The seller declined');
  });

  it('refreshes an expiring access token and keeps the rotated refresh token', async () => {
    const { session } = await signIn();
    clock += 3600_000; // an hour later the access token has expired
    const before = crossly.tokenRequests.length;
    const home = await fetch(`${app}/`, { headers: { cookie: session } });
    expect(await home.text()).toContain('Vintage denim jacket');
    const refresh = crossly.tokenRequests.slice(before).find((f) => f.get('grant_type') === 'refresh_token');
    expect(refresh?.get('refresh_token')).toMatch(/^rt_\d+$/);
  });

  it('revokes the refresh token on sign-out', async () => {
    const { session } = await signIn();
    const res = await fetch(`${app}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: session } });
    expect(res.status).toBe(302);
    expect(crossly.revoked.at(-1)).toMatch(/^rt_\d+$/);
    const home = await fetch(`${app}/`, { headers: { cookie: session } });
    expect(await home.text()).toContain('Sign in with Crossly');
  });
});

describe('PKCE', () => {
  it('makes an RFC 7636 S256 challenge', () => {
    // Appendix B of RFC 7636.
    expect(s256('dBjftJeZ4CVP-mB92K9uhbUQnOvVn1fZC3i7WdHMS7k')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(s256(verifier)).toBe(challenge);
  });
});
