/**
 * OpenAI OAuth — PKCE flow for ChatGPT subscription auth.
 *
 * Enables reusing a ChatGPT Plus/Pro subscription instead of per-token
 * API billing. When OAuth credentials are available, requests go to
 * `chatgpt.com/backend-api/codex/responses` with a Bearer JWT +
 * `chatgpt-account-id` header. Falls back to API key auth at
 * `api.openai.com/v1/responses`.
 *
 * Flow:
 *   1. loginOpenAI() — opens browser, captures auth code via local server
 *   2. Exchange code for tokens (access_token + refresh_token)
 *   3. Extract chatgpt_account_id from JWT claims
 *   4. Persist to ~/.dough/auth.json (0600)
 *   5. getValidToken() — auto-refresh if expired
 */

import { randomBytes, createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, chmod } from "node:fs/promises";

// ── Types ─────────────────────────────────────────────────────────

export interface OpenAICredentials {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number; // epoch ms
  clientId: string;
}

export interface ValidToken {
  token: string;
  accountId: string;
}

export interface AuthEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
}

const DEFAULT_ENDPOINTS: AuthEndpoints = {
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
};

const DEFAULT_CREDS_PATH = join(homedir(), ".dough", "auth.json");
const REDIRECT_URI = "http://127.0.0.1";
const SCOPE = "openid profile email offline_access";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// ── PKCE helpers ──────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ── JWT decode (no signature verification) ────────────────────────

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = Buffer.from(parts[1]!, "base64url").toString("utf-8");
  return JSON.parse(payload);
}

/**
 * Extract the ChatGPT account ID from a JWT access token.
 * The account ID lives in the `https://api.openai.com/auth` claim.
 */
export function extractAccountId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload["https://api.openai.com/auth"] as
    | { user_id?: string; account_id?: string }
    | undefined;

  // Try account_id first, then fall back to organization claim
  const accountId =
    authClaim?.account_id ??
    (payload["https://api.openai.com/profile"] as { account_id?: string } | undefined)
      ?.account_id;

  if (!accountId) {
    throw new Error(
      "Could not extract account ID from JWT. Claims: " +
        JSON.stringify(Object.keys(payload))
    );
  }
  return accountId;
}

// ── Credential persistence ────────────────────────────────────────

export async function loadCredentials(
  path: string = DEFAULT_CREDS_PATH
): Promise<OpenAICredentials | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const data = await file.json();
    return data as OpenAICredentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(
  creds: OpenAICredentials,
  path: string = DEFAULT_CREDS_PATH
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(creds, null, 2));
  await chmod(path, 0o600);
}

// ── Token refresh ─────────────────────────────────────────────────

export async function refreshOpenAIToken(
  refreshToken: string,
  clientId: string,
  endpoints: AuthEndpoints = DEFAULT_ENDPOINTS
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(endpoints.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in,
  };
}

// ── Get valid token (auto-refresh) ────────────────────────────────

export async function getValidToken(
  credsPath: string = DEFAULT_CREDS_PATH
): Promise<ValidToken | null> {
  const creds = await loadCredentials(credsPath);
  if (!creds) return null;

  // Check if token is still valid (with buffer)
  if (Date.now() < creds.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return { token: creds.accessToken, accountId: creds.accountId };
  }

  // Token expired or expiring soon — refresh
  try {
    const refreshed = await refreshOpenAIToken(
      creds.refreshToken,
      creds.clientId
    );

    const accountId = extractAccountId(refreshed.accessToken);
    const updated: OpenAICredentials = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accountId,
      expiresAt: Date.now() + refreshed.expiresIn * 1000,
      clientId: creds.clientId,
    };
    await saveCredentials(updated, credsPath);

    return { token: updated.accessToken, accountId };
  } catch (err) {
    console.warn(
      "[dough] OAuth token refresh failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── Login flow (PKCE) ─────────────────────────────────────────────

export interface LoginCallbacks {
  /** Called with the authorization URL — open it in a browser. */
  onAuthUrl(url: string): void;
  /** Called on success with the credentials. */
  onSuccess?(creds: OpenAICredentials): void;
  /** Called on error. */
  onError?(err: Error): void;
}

/**
 * Start the OAuth PKCE login flow.
 *
 * 1. Generates PKCE code verifier + challenge
 * 2. Starts a local HTTP server on a free port to capture the redirect
 * 3. Calls onAuthUrl with the authorization URL (caller opens browser)
 * 4. Exchanges the auth code for tokens
 * 5. Persists credentials to disk
 */
export async function loginOpenAI(
  clientId: string,
  callbacks: LoginCallbacks,
  options?: {
    credsPath?: string;
    endpoints?: AuthEndpoints;
  }
): Promise<void> {
  const endpoints = options?.endpoints ?? DEFAULT_ENDPOINTS;
  const credsPath = options?.credsPath ?? DEFAULT_CREDS_PATH;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Start local server on a free port to capture the OAuth redirect
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const server = Bun.serve({
      port: 0, // OS assigns a free port
      async fetch(req) {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          const err = new Error(`OAuth error: ${error}`);
          callbacks.onError?.(err);
          rejectPromise(err);
          server.stop();
          return new Response(
            "<html><body><h1>Authentication failed</h1><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        if (!code) {
          return new Response("Waiting for OAuth callback...", { status: 200 });
        }

        try {
          // Exchange code for tokens
          const redirectUri = `${REDIRECT_URI}:${server.port}`;
          const tokenRes = await fetch(endpoints.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grant_type: "authorization_code",
              client_id: clientId,
              code,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier,
            }),
          });

          if (!tokenRes.ok) {
            const body = await tokenRes.text();
            throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
          }

          const data = (await tokenRes.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };

          const accountId = extractAccountId(data.access_token);
          const creds: OpenAICredentials = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            accountId,
            expiresAt: Date.now() + data.expires_in * 1000,
            clientId,
          };

          await saveCredentials(creds, credsPath);
          callbacks.onSuccess?.(creds);
          resolvePromise();
          server.stop();

          return new Response(
            "<html><body><h1>Authenticated!</h1><p>You can close this tab and return to Dough.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          callbacks.onError?.(error);
          rejectPromise(error);
          server.stop();
          return new Response(
            `<html><body><h1>Authentication failed</h1><p>${error.message}</p></body></html>`,
            { headers: { "Content-Type": "text/html" } }
          );
        }
      },
    });

    // Build authorization URL with PKCE
    const redirectUri = `${REDIRECT_URI}:${server.port}`;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      audience: "https://api.openai.com/v1",
    });

    const authUrl = `${endpoints.authorizeUrl}?${params.toString()}`;
    callbacks.onAuthUrl(authUrl);
  });
}
