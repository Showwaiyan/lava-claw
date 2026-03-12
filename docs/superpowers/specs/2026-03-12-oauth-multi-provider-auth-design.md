# OAuth Multi-Provider Auth Design

**Date:** 2026-03-12
**Status:** Approved

---

## Background

The Lava Claw plugin currently supports Gemini via two auth methods:

- `apikey` — user pastes an API key into settings
- `cli` — the plugin spawns a `gemini` subprocess, which is broken (no tool calling, no session history, re-asks identity every turn)

This spec replaces the `cli` auth method with a proper `oauth` flow (browser-based sign-in), adds dynamic model listing via the provider API, and designs the auth layer to support multiple providers in the future.

The Gemini CLI subprocess (`runGeminiCLI`, `completeViaCLI`) is removed entirely.

---

## Goals

1. Users authenticate with Gemini by signing in via browser (no CLI dependency, no API key required)
2. OAuth tokens are stored in `.lava-claw/oauth/<providerId>.json` and auto-refreshed silently
3. Available models are fetched from the provider API after sign-in and cached in settings
4. The auth layer is generic enough that adding a second provider (e.g. OpenAI) requires only registering a new `ProviderConfig` — no structural changes
5. Full tool calling and session history work identically to the existing `apikey` path

## Non-Goals

- OAuth for providers other than Gemini (architecture supports it, implementation deferred)
- Mobile support (plugin is `isDesktopOnly: true`)
- Local HTTP redirect callback server (not possible in Obsidian; user pastes code instead)

---

## Auth Flow

### One-time setup

1. User opens Settings → clicks **"Sign in with Google"**
2. `AuthService.startOAuthFlow('gemini')` generates an authorization URL:
   - endpoint: `https://accounts.google.com/o/oauth2/auth`
   - `client_id`: bundled constant (Gemini OAuth client ID)
   - `redirect_uri`: `urn:ietf:wg:oauth:2.0:oob` (out-of-band — no local server needed)
   - `scope`: `https://www.googleapis.com/auth/generative-language`
   - `access_type`: `offline` (to receive a `refresh_token`)
   - `response_type`: `code`
3. `OAuthModal` opens — displays the URL and a "Open in browser" button (`window.open`)
4. User authenticates in browser; Google displays an auth code on screen
5. User copies the code (or the full callback URL) and pastes it into the modal's text field
6. User clicks **"Connect"**
7. `AuthService.handleOAuthCallback('gemini', input)` extracts the `code` parameter (handles both raw code and full URL), POSTs to `https://oauth2.googleapis.com/token`:
   ```
   grant_type=authorization_code
   code=<code>
   redirect_uri=urn:ietf:wg:oauth:2.0:oob
   client_id=<clientId>
   client_secret=<clientSecret>
   ```
8. Response: `{ access_token, refresh_token, expires_in, id_token }`
9. Stored to `.lava-claw/oauth/gemini.json`:
   ```json
   {
     "access_token": "...",
     "refresh_token": "...",
     "expiry_date": 1234567890000,
     "email": "user@example.com"
   }
   ```
   `email` extracted from `id_token` JWT payload (base64 decode middle segment, parse JSON, read `email`)
10. Settings tab updates to show **"Connected as user@example.com"** with a **"Sign out"** button
11. Model list is fetched and cached (see Model Listing section)

### Token refresh

Before every API call, `AuthService.getToken('gemini')`:

1. Reads stored creds from `.lava-claw/oauth/gemini.json`
2. If `expiry_date > Date.now() + 60_000` (1 minute buffer) → return `access_token` directly
3. Otherwise POST to `https://oauth2.googleapis.com/token`:
   ```
   grant_type=refresh_token
   refresh_token=<refresh_token>
   client_id=<clientId>
   client_secret=<clientSecret>
   ```
4. Response: `{ access_token, expires_in }`
5. Update stored creds (`access_token`, `expiry_date`); `refresh_token` is unchanged
6. Return new `access_token`

If refresh fails (token revoked, network error), throw a typed `AuthError` with message "Re-authentication required". `GeminiService` catches this and shows a `new Notice(...)` with instructions to re-sign in.

### Sign out

`AuthService.signOut('gemini')`:
1. Deletes `.lava-claw/oauth/gemini.json`
2. Clears cached model list from settings
3. Settings tab reverts to "Sign in with Google" button

---

## Model Listing

After OAuth sign-in completes (step 10 above):

1. `AuthService.listModels('gemini')` calls:
   ```
   GET https://generativelanguage.googleapis.com/v1beta/models
   Authorization: Bearer <access_token>
   ```
2. Filters response to models where `supportedGenerationMethods` includes `generateContent`
3. Returns `Model[]`:
   ```ts
   interface Model {
     id: string        // e.g. "gemini-2.0-flash"
     displayName: string  // e.g. "Gemini 2.0 Flash"
   }
   ```
4. Stored in plugin settings (`cachedModels: Model[]`) via `saveData`
5. Settings tab renders a dropdown of `displayName` values; selection updates `settings.model`

A **"Refresh models"** button next to the dropdown re-calls `listModels` and updates the cache.

If `listModels` fails, settings shows the currently selected model as plain text + a `Notice` error.

---

## Architecture

### New files

**`src/services/auth.ts` — `AuthService`**

```ts
interface ProviderConfig {
  id: string
  authUrl: string
  tokenUrl: string
  modelsUrl: string
  scopes: string[]
  clientId: string
  clientSecret: string
}

class AuthService {
  register(config: ProviderConfig): void
  startOAuthFlow(providerId: string): void          // generates URL, opens OAuthModal
  handleOAuthCallback(providerId: string, input: string): Promise<void>
  getToken(providerId: string): Promise<string>     // returns valid Bearer token
  isAuthenticated(providerId: string): boolean
  listModels(providerId: string): Promise<Model[]>
  signOut(providerId: string): Promise<void>
  getEmail(providerId: string): string | null
}
```

`AuthService` receives `app: App` (for vault file access) and `plugin: Plugin` (for `saveData`) via constructor.

**`src/ui/oauth-modal.ts` — `OAuthModal`**

Simple `Modal` subclass:
- Displays auth URL as a copyable link
- "Open in browser" button (`window.open(url)`)
- Text input for pasting the code or callback URL
- "Connect" button → calls `AuthService.handleOAuthCallback` → closes modal on success, shows error inline on failure

### Changed files

**`src/settings.ts`**
- `authMethod: 'apikey' | 'cli'` → `authMethod: 'apikey' | 'oauth'`
- Add `cachedModels: Model[]` to `LavaClawSettings`
- `SampleSettingTab` gains:
  - OAuth section: "Sign in with Google" button or "Connected as \<email\>" + "Sign out"
  - Model dropdown (populated from `cachedModels`) replacing any hardcoded model selector
  - "Refresh models" button

**`src/services/gemini.ts`**
- Remove `completeViaCLI`, `runGeminiCLI`, all CLI subprocess code
- `complete()` calls `AuthService.getToken('gemini')` when `authMethod === 'oauth'`; API key path unchanged
- Constructor receives `authService: AuthService`

**`src/main.ts`**
- Instantiate `AuthService`, register Gemini `ProviderConfig`
- Pass `authService` to `GeminiService` and `SampleSettingTab`

**`src/core.ts`** — no changes

### Credential storage

Credentials are stored as plain JSON under `.lava-claw/oauth/`. The vault's `.lava-claw/` directory is already in use for workspace files. The `oauth/` subdirectory is new.

No encryption beyond what the OS provides for vault files. This matches how the Gemini CLI stores its own credentials in `~/.gemini/oauth_creds.json`.

### Bundled OAuth client credentials

The `client_id` and `client_secret` are bundled as constants in `src/services/auth.ts`. This is standard practice for desktop OAuth clients (the secret is not truly secret for installed apps per RFC 8252). The Gemini CLI itself uses this same pattern.

---

## Settings migration

Users currently on `authMethod: 'cli'` are migrated to `authMethod: 'oauth'` on plugin load. A `Notice` informs them: "Gemini CLI mode has been replaced with OAuth sign-in. Please sign in again in Settings."

Users on `authMethod: 'apikey'` are unaffected.

---

## Error handling

| Scenario | Handling |
|---|---|
| OAuth code exchange fails | Show error message inline in `OAuthModal` |
| Token refresh fails | Throw `AuthError`, `GeminiService` shows `Notice` prompting re-sign-in |
| `listModels` fails | `Notice` error, fall back to existing `settings.model` value |
| Creds file missing/corrupt | Treat as unauthenticated, show "Sign in" button |
| Network offline | Propagate error to caller; existing `Notice` handling in `core.ts` covers it |

---

## Out-of-scope (future work)

- OpenAI, Anthropic, or other provider OAuth registration
- Encrypting stored credentials
- Auto-opening browser without user clicking (security consideration)
- Token revocation on sign-out (calling Google's revocation endpoint)
