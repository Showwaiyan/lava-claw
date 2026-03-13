# OAuth Multi-Provider Auth Design

**Date:** 2026-03-12
**Status:** Approved (revised — openclaw PKCE approach)

---

## Background

The Lava Claw plugin currently supports Gemini via two auth methods:

- `apikey` — user pastes an API key into settings
- `cli` — the plugin spawns a `gemini` subprocess, which is broken (no tool calling, no session history, re-asks identity every turn)

This spec replaces the `cli` auth method with a proper `oauth` flow (browser-based sign-in using PKCE and the installed Gemini CLI's bundled OAuth credentials), adds dynamic model listing via the provider API, and designs the auth layer to support multiple providers in the future.

The Gemini CLI subprocess (`runGeminiCLI`, `completeViaCLI`) is removed entirely.

---

## Goals

1. Users authenticate with Gemini by signing in via browser — no CLI dependency, no API key required
2. OAuth credentials are extracted dynamically from the installed `gemini` CLI binary — no hardcoded client ID/secret in the plugin
3. PKCE flow with `localhost:8085` redirect — browser redirects automatically, modal closes without user action
4. Manual paste fallback if local server creation fails (port conflict, unusual env)
5. OAuth tokens stored in `.lava-claw/oauth/gemini.json` and auto-refreshed silently
6. Google Cloud Project ID discovered via `cloudcode-pa.googleapis.com` after token exchange
7. Available models fetched from the provider API after sign-in and cached in settings
8. The auth layer is generic enough that adding a second provider requires only registering a new `ProviderConfig`

## Non-Goals

- OAuth for providers other than Gemini (architecture supports it, implementation deferred)
- Mobile support (plugin is `isDesktopOnly: true`)
- Encrypting stored credentials
- Token revocation on sign-out

---

## Auth Flow

### One-time setup

1. User opens Settings → clicks **"Sign in with Google"**
2. `AuthService.startOAuthFlow('gemini')` is called:
   a. Calls `extractGeminiCliCredentials()` — if it returns `null`, shows a `Notice` with install instructions and aborts
   b. Generates a PKCE pair: `verifier` (32 random bytes, hex) and `challenge` (SHA-256 of verifier, base64url)
   c. Attempts to start a local HTTP server on `localhost:8085`
   d. If server starts: opens `OAuthModal` in **local mode** (shows "Opening browser…", "Cancel" button), opens browser automatically
   e. If server fails (port in use, etc.): opens `OAuthModal` in **manual mode** (shows auth URL + paste field)
3. User authenticates in browser; Google redirects to `http://localhost:8085/oauth2callback?code=…&state=…`
4. Local server captures `code` and `state`, verifies state matches verifier, shuts down
5. `AuthService` exchanges code for tokens (POST `https://oauth2.googleapis.com/token`) with `code_verifier`
6. Fetches user email from `https://www.googleapis.com/oauth2/v1/userinfo`
7. Discovers GCP project ID via `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
8. Stores credentials to `.lava-claw/oauth/gemini.json`
9. `OAuthModal` closes automatically; settings tab updates to show "Connected as user@example.com"
10. Model list is fetched and cached in settings

**Manual mode fallback (step 3–4 replaced):**
- Modal shows the auth URL and a text input
- User opens the URL manually, authenticates, and pastes the full redirect URL (`http://localhost:8085/oauth2callback?code=…&state=…`) into the field
- `AuthService` parses the pasted URL to extract `code` and `state`

### Token refresh

Before every API call, `AuthService.getToken('gemini')`:

1. Reads stored creds from cache (populated lazily from disk on first call)
2. If `expiry_date > Date.now() + 60_000` (1-minute buffer) → return `access_token` directly
3. Otherwise POST to `https://oauth2.googleapis.com/token`:
   ```
   grant_type=refresh_token
   refresh_token=<refresh_token>
   client_id=<clientId>
   client_secret=<clientSecret>
   ```
4. Update stored creds (`access_token`, `expiry_date`); `refresh_token` and `projectId` are unchanged
5. Return new `access_token`

If refresh fails, throw `AuthError('Re-authentication required')`. `GeminiService` catches this and shows a `Notice`.

### Sign out

`AuthService.signOut('gemini')`:
1. Deletes `.lava-claw/oauth/gemini.json`
2. Clears in-memory cache entry
3. Clears `cachedModels` from settings
4. Settings tab reverts to "Sign in with Google" button

---

## Credential Extraction

**`src/services/gemini-cli-creds.ts`** — new file, pure function:

```ts
export function extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null
```

Algorithm:
1. Check env vars first: `GEMINI_CLI_OAUTH_CLIENT_ID` / `GEMINI_CLI_OAUTH_CLIENT_SECRET` — if set, return them immediately
2. Walk `process.env.PATH` entries, find first `gemini` binary (or `gemini.cmd`/`gemini.bat`/`gemini.exe` on Windows)
3. Resolve symlinks with `realpathSync`
4. Try these candidate paths for `oauth2.js`:
   - `<resolvedDir>/../node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js`
   - `<resolvedDir>/../node_modules/@google/gemini-cli-core/dist/code_assist/oauth2.js`
   - `<binDir>/node_modules/@google/gemini-cli/…` and `../lib/node_modules/@google/gemini-cli/…`
   - Depth-10 `findFile` fallback
5. Regex `clientId = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/)` and `clientSecret = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/)`
6. Cache result in module-level variable; return `null` on any failure

Uses `(window as any).require('fs')` and `(window as any).require('path')` — available in Electron's renderer process. Wrapped in `try/catch`; returns `null` on any error.

---

## PKCE Flow

PKCE generation: `verifier` = 32 random bytes as hex string; `challenge` = `base64url(sha256(verifier))`; `state` = separate 16 random bytes as hex string (independent from verifier, for CSRF protection). Uses `window.require('crypto')` for `randomBytes` and `createHash`.

Auth URL parameters:
```
client_id=<clientId>
response_type=code
redirect_uri=http://localhost:8085/oauth2callback
scope=https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile
code_challenge=<base64url(sha256(verifier))>
code_challenge_method=S256
state=<state>
access_type=offline
prompt=consent
```

Token exchange adds `code_verifier=<verifier>`.

The local server (and manual paste parser) verifies that the returned `state` matches the generated `state` value before proceeding with token exchange. A mismatch rejects with `AuthError('OAuth state mismatch')`.

---

## Project Discovery

After token exchange:

1. POST `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` with `Authorization: Bearer <access_token>`
2. Body: `{ metadata: { ideType: "ANTIGRAVITY", platform: "MACOS"|"WINDOWS"|"PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }`
3. If response contains `cloudaicompanionProject` (string or `{id}`), use it as `projectId`
4. If response indicates free tier (no `currentTier`): POST `…/v1internal:onboardUser` with `{ tierId: "free-tier", metadata: … }`, poll operation until `done`
5. If env var `GOOGLE_CLOUD_PROJECT` is set, use it instead and skip the API calls
6. `projectId` is stored in `StoredCreds` and passed as `x-goog-user-project` header in Gemini API requests when using OAuth

`requestUrl` (Obsidian API) is used for all network calls in this step.

---

## Credential Storage

Stored as JSON at `.lava-claw/oauth/<providerId>.json`:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expiry_date": 1234567890000,
  "email": "user@example.com",
  "projectId": "my-gcp-project-123"
}
```

No encryption beyond OS-level vault file protection. Matches the pattern used by the Gemini CLI (`~/.gemini/oauth_creds.json`).

---

## Model Listing

After OAuth sign-in completes:

1. `AuthService.listModels('gemini')` calls:
   ```
   GET https://generativelanguage.googleapis.com/v1beta/models
   Authorization: Bearer <access_token>
   x-goog-user-project: <projectId>
   ```
2. Filters to models where `supportedGenerationMethods` includes `generateContent`
3. Returns `OAuthModel[]` (`id`, `displayName`)
4. Stored in `settings.llm.cachedModels` via `saveData`
5. Settings renders a dropdown; "Refresh" button re-calls `listModels`

---

## Architecture

### New files

**`src/services/gemini-cli-creds.ts`**
- `extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null`
- Module-level cache; uses `window.require('fs')` and `window.require('path')`

### Changed files

**`src/services/auth.ts`**
- `ProviderConfig`: remove `clientId`, `clientSecret` fields
- `StoredCreds`: add `projectId: string`
- `generateAuthUrl` → replaced by internal `buildAuthUrl(challenge, verifier)` using PKCE params and `localhost:8085` redirect URI
- `handleOAuthCallback` → replaced by `startLocalServer()` + `exchangeCodeForTokens(code, verifier, config)` internal methods
- `startOAuthFlow`: extract credentials first, generate PKCE pair, attempt local server; fall back to manual mode; open `OAuthModal` appropriately
- Add `discoverProject(token): Promise<string>` — project discovery call
- Add `getUserEmail(token): Promise<string>` — userinfo call
- Remove `generateAuthUrl` from public API

**`src/ui/oauth-modal.ts`**
- Two constructor modes: `local` (shows "Opening browser…" + Cancel) and `manual` (shows URL + paste field)
- Local mode: modal has a `complete(success: boolean)` method called by `AuthService` when callback is received or cancelled
- Manual mode: functionally similar to old modal but expects full redirect URL (not bare code); parses `?code=` and `?state=` from pasted URL

**`src/services/gemini.ts`**
- `completeViaOAuth`: after getting token, also get `projectId` from creds and add `x-goog-user-project` header
- Since `GoogleGenerativeAI` SDK doesn't support custom headers directly, use `requestUrl` for OAuth path instead of the SDK, or pass token as API key and set project via `baseApiUrl` override if available; otherwise accept the limitation and note it for future work

**`src/core.ts`**
- Remove `clientId: 'YOUR_GEMINI_CLIENT_ID'` and `clientSecret: 'YOUR_GEMINI_CLIENT_SECRET'` from `register()` call
- `ProviderConfig` no longer has these fields

**`src/types.ts`** — no changes needed

**`src/settings.ts`** — no changes needed (UI already correct)

**`src/main.ts`** — no changes needed

---

## GeminiService OAuth path and x-goog-user-project

The `@google/generative-ai` SDK initialised with a Bearer token instead of an API key works for model calls. The `x-goog-user-project` header is required for billing on non-free-tier accounts. Since the SDK doesn't expose per-request header injection, we pass `projectId` via the SDK's `requestOptions` at model construction time if the SDK supports it — otherwise we note this as a known limitation and users with standard-tier accounts may need to set `GOOGLE_CLOUD_PROJECT`. Free-tier accounts are unaffected.

---

## Settings Migration

Users on `authMethod: 'cli'` are migrated to `authMethod: 'oauth'` on plugin load (already implemented). A `Notice` informs them to sign in again.

Users on `authMethod: 'apikey'` are unaffected.

---

## Error Handling

| Scenario | Handling |
|---|---|
| Gemini CLI not installed | `Notice` with install instructions; auth flow aborts |
| Port 8085 in use | Fall back to manual paste mode automatically |
| OAuth code exchange fails | Show error inline in `OAuthModal` |
| State mismatch in callback | Reject with `AuthError('OAuth state mismatch')` |
| Token refresh fails | Throw `AuthError`, `GeminiService` shows `Notice` prompting re-sign-in |
| Project discovery fails | Throw `AuthError` with message; user must set `GOOGLE_CLOUD_PROJECT` env var |
| `listModels` fails | `Notice` error; fall back to existing `settings.model` value |
| Creds file missing/corrupt | Treat as unauthenticated; show "Sign in" button |
| Network offline | Propagate error; existing `Notice` handling in `GeminiService` covers it |

---

## Out-of-scope (future work)

- OpenAI, Anthropic, or other provider OAuth
- Encrypting stored credentials
- Token revocation on sign-out
- `x-goog-user-project` injection via SDK (standard-tier workaround)
