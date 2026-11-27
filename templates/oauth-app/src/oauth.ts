// OAuth 2.0 authorization code flow with PKCE against Crossly's authorization
// server. Everything here comes from https://crossly.net/docs/api-authentication
// and the server's discovery document:
//
//   issuer                 https://crossly.net/atlas
//   discovery              {issuer}/.well-known/openid-configuration
//   authorize / token      {issuer}/oauth2/authorize, {issuer}/oauth2/token
//   PKCE                   required, S256 only
//   resource               https://crossly.net/api/v1 (the API, as an RFC 8707 resource)
//   scope                  must include `openid`; add `offline_access` for a refresh token
//   client auth            client_secret_basic for a confidential app; client_id only for a public one
//   refresh tokens         rotate: always keep the new one
import { createHash, randomBytes } from 'node:crypto';

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
  authorization_response_iss_parameter_supported?: boolean;
}

export interface TokenSet {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export interface ClientConfig {
  issuer: string;
  clientId: string;
  /** Empty for a public client (PKCE only). */
  clientSecret?: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  return { verifier, challenge: s256(verifier) };
}

export function s256(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export async function discover(issuer: string, doFetch: typeof fetch = fetch): Promise<Discovery> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await doFetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new OAuthError('discovery_failed', `GET ${url} answered ${res.status}`, res.status);
  const doc = (await res.json()) as Discovery;
  if (doc.issuer !== issuer.replace(/\/$/, '')) {
    throw new OAuthError('issuer_mismatch', `Discovery says issuer ${doc.issuer}, expected ${issuer}`);
  }
  if (doc.code_challenge_methods_supported && !doc.code_challenge_methods_supported.includes('S256')) {
    throw new OAuthError('pkce_unsupported', 'The authorization server does not offer PKCE S256.');
  }
  return doc;
}

export function authorizationUrl(
  discovery: Discovery,
  client: ClientConfig,
  { state, codeChallenge, nonce }: { state: string; codeChallenge: string; nonce: string },
): string {
  const url = new URL(discovery.authorization_endpoint);
  const scopes = new Set(['openid', ...client.scopes]);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: [...scopes].join(' '),
    resource: client.resource,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function tokenRequest(
  discovery: Discovery,
  client: ClientConfig,
  params: Record<string, string>,
  doFetch: typeof fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (client.clientSecret) {
    // client_secret_basic: both parts form-urlencoded first (RFC 6749 section 2.3.1).
    const id = encodeURIComponent(client.clientId);
    const secret = encodeURIComponent(client.clientSecret);
    headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
  }
  const res = await doFetch(discovery.token_endpoint, { method: 'POST', headers, body });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenSet> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new OAuthError(json.error ?? 'token_error', json.error_description ?? `Token endpoint answered ${res.status}`, res.status);
  }
  return json as TokenSet;
}

export function exchangeCode(
  discovery: Discovery,
  client: ClientConfig,
  { code, codeVerifier }: { code: string; codeVerifier: string },
  doFetch: typeof fetch = fetch,
): Promise<TokenSet> {
  return tokenRequest(
    discovery,
    client,
    { grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: client.redirectUri, resource: client.resource },
    doFetch,
  );
}

/** Refresh tokens rotate: the response carries a NEW refresh_token. Store it; the old one is spent. */
export function refreshTokens(discovery: Discovery, client: ClientConfig, refreshToken: string, doFetch: typeof fetch = fetch): Promise<TokenSet> {
  return tokenRequest(discovery, client, { grant_type: 'refresh_token', refresh_token: refreshToken, resource: client.resource }, doFetch);
}

export async function revoke(discovery: Discovery, client: ClientConfig, token: string, doFetch: typeof fetch = fetch): Promise<void> {
  if (!discovery.revocation_endpoint) return;
  const body = new URLSearchParams({ token, token_type_hint: 'refresh_token' });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (client.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
  }
  await doFetch(discovery.revocation_endpoint, { method: 'POST', headers, body }).catch(() => undefined);
}

export interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  [claim: string]: unknown;
}

export async function userInfo(discovery: Discovery, accessToken: string, doFetch: typeof fetch = fetch): Promise<UserInfo> {
  const res = await doFetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  if (!res.ok) throw new OAuthError('userinfo_failed', `userinfo answered ${res.status}`, res.status);
  return (await res.json()) as UserInfo;
}
