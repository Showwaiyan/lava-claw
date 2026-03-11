# Lava Claw — Plugin Design Spec

**Date:** 2026-03-11
**Status:** Approved

---

## Overview

Lava Claw is a desktop-only Obsidian community plugin that embeds a personal AI assistant directly into Obsidian. It is inspired by OpenClaw but runs fully in-process — no separate server, no background daemon. The plugin IS the assistant runtime. It integrates with Telegram for mobile/remote interaction, uses Google Gemini as its LLM provider, and reads the user's vault as context.

**Constraints:**
- Desktop only (`isDesktopOnly: true`)
- TypeScript/Node only — no Python
- No sub-agents in v1
- No automated test suite — manual validation via vault install
- Mobile users interact via Telegram only (routed to the desktop plugin)

---

## Architecture

### Approach: Layered modules with a central `PluginCore` orchestrator

`main.ts` is minimal — it loads settings, creates `PluginCore`, and delegates everything. `PluginCore` owns the lifecycle of all sub-services via a formal `Service` interface.

```
LavaClawPlugin (main.ts)
└── PluginCore (core.ts)
    ├── TelegramService     — grammY bot, long polling, message ingress
    ├── GeminiService       — Gemini API/CLI, prompt construction, streaming
    ├── MemoryService       — read/write .lava-claw/ markdown files in vault
    ├── SkillsService       — load, index, install, remove skill files
    └── ChatView            — Obsidian ItemView, chat UI, message ingress
```

### `Service` interface

All services implement:

```ts
interface Service {
    init(): Promise<void>
    destroy(): Promise<void>
}
```

`PluginCore` maintains a `Service[]` registry. `init()` initializes all services in order; `destroy()` tears them down in reverse. Adding a new service requires no changes to the orchestrator lifecycle.

### `MessageSource` interface

Channels (Telegram, ChatView) implement:

```ts
interface MessageSource {
    id: string
    reply(turn: ConversationTurn): Promise<void>
}
```

`PluginCore.handleMessage(text, source)` receives a message and its origin. After getting the LLM response, it calls `source.reply()` to route the answer back. Adding a new channel = implement `MessageSource`, add to settings dropdown, ship release.

### `LLMProvider` interface

LLM providers implement:

```ts
interface LLMProvider extends Service {
    complete(prompt: Prompt): Promise<AsyncIterable<string>>
}
```

v1 ships `GeminiService` only. Adding another provider = implement `LLMProvider`, add to settings dropdown, ship release.

### Message flow

Every message — from Telegram or ChatView — follows the same path:

```
[Telegram / ChatView]
→ PluginCore.handleMessage(text, source)
    → MemoryService.getContext()          // SOUL.md + memory.md + today's log
    → VaultService.searchRelevant(text)   // relevant vault notes (if read permission on)
    → SkillsService.resolveSkills(text)   // matched skill files
    → GeminiService.complete(prompt)      // build prompt, stream response
    → MemoryService.appendToDaily(turn)   // log exchange to daily log
    → source.reply(turn)                  // route reply back to origin
```

### Plugin lifecycle

- `onload`: load settings → create `PluginCore` → `core.init()`
- `onunload`: `core.destroy()`

`core.init()` starts services in order: memory → skills → gemini → telegram → chat view.
`core.destroy()` stops in reverse.

### `src/` structure

```
src/
  main.ts              # Plugin class — onload/onunload only
  settings.ts          # LavaClawSettings, DEFAULT_SETTINGS, SettingTab
  types.ts             # Service, MessageSource, LLMProvider, Message, ConversationTurn, Prompt, SkillFile, VaultPermissions
  core.ts              # PluginCore — service registry, handleMessage(), restartService()
  services/
    telegram.ts        # TelegramService implements Service, MessageSource
    gemini.ts          # GeminiService implements Service, LLMProvider
    memory.ts          # MemoryService implements Service
    skills.ts          # SkillsService implements Service
    vault.ts           # VaultService implements Service — vault search and read
  ui/
    chat-view.ts       # ChatView implements Service, MessageSource
```

---

## Vault Data Layout

All plugin-owned files live in a hidden folder at the vault root:

```
<vault>/
└── .lava-claw/
    ├── SOUL.md              # Personality/identity — injected into every system prompt
    ├── TOOLS.md             # Tools manifest — auto-generated, describes capabilities
    ├── memory.md            # Long-term durable facts and preferences
    ├── memory/
    │   └── YYYY-MM-DD.md    # Daily logs — append-only, one file per day
    └── skills/
        └── *.md             # User-defined or installed skill files
```

The workspace folder path defaults to `.lava-claw` and is configurable in settings.

### File ownership

| File | Who writes it | Purpose |
|---|---|---|
| `SOUL.md` | User | Defines assistant personality, tone, identity |
| `TOOLS.md` | Plugin (auto-generated on first run) | Describes available tools/commands to the LLM |
| `memory.md` | User + LLM (on request) | Durable facts: name, preferences, recurring context |
| `memory/YYYY-MM-DD.md` | Plugin (auto) | Append-only log of each day's conversation turns |
| `skills/*.md` | User / installed via settings | Task-specific instructions |

### Prompt context injection order

1. `SOUL.md` — always (system prompt)
2. `memory.md` — always (persistent facts)
3. Today's `memory/YYYY-MM-DD.md` — always (today's context)
4. Relevant vault notes — auto-searched based on message topic (if read permission on)
5. Explicitly referenced notes — `[[note name]]` syntax in user message
6. Matched skill files — when user invokes `/skill <name>`
7. Conversation history — last N turns (configurable, default 10)
8. User message

### `MemoryService` responsibilities

- `init()` — ensure `.lava-claw/` folder structure exists; create defaults if missing
- `getContext()` — returns `SOUL.md` + `memory.md` + today's daily log as string
- `appendToDaily(turn)` — appends `ConversationTurn` to today's `memory/YYYY-MM-DD.md`
- `updateMemory(content)` — overwrites `memory.md` (called when LLM is asked to remember something)

All reads/writes use Obsidian's `vault.adapter` API — never raw `fs`.

### `VaultService` responsibilities

- `searchRelevant(query)` — full-text search across vault notes, returns top matches as context strings
- `readNote(path)` — reads a specific note by path
- `createNote(path, content)` — creates a new note (requires create permission)
- `updateNote(path, content)` — updates an existing note (requires update permission)
- `deleteNote(path)` — deletes a note (requires delete permission)

All operations check vault permissions before executing.

### First-run initialization

On first `onload`, if `.lava-claw/` does not exist:

1. Create folder structure
2. Generate default `SOUL.md` with placeholder personality
3. Generate default `TOOLS.md` describing available capabilities
4. Create empty `memory.md`
5. Show `Notice`: "Lava Claw initialized. Configure your AI provider and messaging channel in Settings to get started."

---

## Vault Permissions

Global toggles in the Obsidian plugin settings tab:

| Permission | Default | Description |
|---|---|---|
| Read notes | On | LLM can read and inject vault notes as context |
| Create notes | Off | LLM can create new notes |
| Update notes | Off | LLM can modify existing notes |
| Delete notes | Off | LLM can delete notes |

```ts
interface VaultPermissions {
    read: boolean    // default: true
    create: boolean  // default: false
    update: boolean  // default: false
    delete: boolean  // default: false
}
```

`VaultService` checks the relevant flag before any operation. If the permission is off, the operation is skipped and the LLM is informed it lacks that permission.

---

## Gemini Integration

### Authentication

Two auth methods, user selects in settings:

| Method | How |
|---|---|
| API Key | User pastes Gemini API key in settings tab |
| Gemini CLI OAuth | Plugin shells out to `gemini` CLI — user already authenticated |

### `Prompt` structure

```ts
interface Prompt {
    system: string             // SOUL.md
    memory: string             // memory.md + today's daily log
    vaultContext: string       // relevant vault notes
    skills: string[]           // matched skill file contents
    history: ConversationTurn[] // last N turns
    message: string            // current user message
}
```

### Streaming

`GeminiService.complete()` returns `AsyncIterable<string>` (token chunks). `ChatView` renders chunks as they arrive. Telegram waits for the full response before sending (single message).

### LLM settings

```ts
interface LLMSettings {
    provider: 'gemini'
    authMethod: 'apikey' | 'cli'
    apiKey: string
    model: string          // e.g. 'gemini-2.0-flash', 'gemini-2.5-pro'
    historyLength: number  // default: 10
}
```

---

## Chat UI (ChatView)

### Overview

`ChatView` is an Obsidian `ItemView` that implements both `Service` and `MessageSource`. It opens as a panel in the Obsidian workspace.

### Entry points

- Ribbon icon — opens/focuses the chat panel
- Command palette — "Lava Claw: Open chat"

### Layout

```
┌─────────────────────────────┐
│  Lava Claw          [clear] │
├─────────────────────────────┤
│                             │
│  [user] Hello               │
│                             │
│  [assistant] Hi! How can    │
│  I help you today?          │
│                             │
│  [assistant] ▌              │  ← streaming cursor
│                             │
├─────────────────────────────┤
│  [input field        ] [→]  │
└─────────────────────────────┘
```

### Behavior

- Assistant messages render as Markdown via `MarkdownRenderer.render()`
- Token chunks append to the last assistant bubble in real time during streaming
- Auto-scrolls to bottom on new content; user can scroll up freely
- Enter to send, Shift+Enter for newline
- Input disabled while awaiting response

### Session model

- **One session** in v1 — no session switching
- Session lives in `PluginCore`'s in-memory `ConversationTurn[]` array
- Closing the panel does NOT destroy the session — reopening restores it
- Closing Obsidian destroys the session (expected)
- Session is shared across channels — Telegram and ChatView see the same history
- Explicit clear: "clear" button in header or "Lava Claw: Clear chat" command — wipes in-memory session and UI

### `ChatView` responsibilities

- `init()` — register view with Obsidian workspace; restore in-memory session if it exists
- `destroy()` — deregister view (called only on plugin unload)
- `clearSession()` — wipes `PluginCore`'s conversation history and clears UI
- `reply(turn)` — appends `ConversationTurn` to UI
- `onMessage(text)` — calls `PluginCore.handleMessage(text, this)`

---

## Telegram Integration

### Overview

`TelegramService` implements both `Service` and `MessageSource`. Uses the grammY library with long polling — no webhook, no port forwarding required.

### Lifecycle

- `init()` — if token configured: create grammY `Bot`, register handler, start long polling. If no token: no-op + log notice.
- `destroy()` — call `bot.stop()`

### Authorization

```ts
// Authorization logic
if (userId === settings.telegram.ownerUserId) → allow
if (settings.telegram.allowedUserIds.includes(userId)) → allow
else → drop / reply "unauthorized"
```

### Owner ID detection

Settings tab has a "Detect my ID" button — user messages their bot once, the plugin captures `ctx.from.id` and auto-populates the `ownerUserId` field.

### Telegram settings

```ts
interface TelegramSettings {
    enabled: boolean
    botToken: string
    ownerUserId: string
    allowedUserIds: string[]
}
```

### Future proactive messages

The `chatId` from the first authorized inbound message is stored in settings. This enables future plugin → Telegram notifications (e.g. from `SchedulerService`). Deferred to a future release.

---

## Skills System

### Storage

Skills are markdown files in `.lava-claw/skills/`. Each file is a self-contained instruction set for a specific task or domain.

### Installation (via settings tab)

- **From file** — user provides local file path; plugin copies to `.lava-claw/skills/<name>.md`
- **From GitHub** — user pastes GitHub URL; plugin fetches raw content and saves to `.lava-claw/skills/<name>.md`

### Settings UI

- List of installed skills (name + remove button)
- "Add skill" button → modal with two tabs: From file / From GitHub
- Remove button deletes the `.md` file from vault

### `SkillsService` responsibilities

- `init()` — scan `.lava-claw/skills/` and index available skills
- `resolveSkills(query)` — return skill contents matching current invocation
- `installFromFile(path)` — copy local file into skills folder (requires create permission)
- `installFromGitHub(url)` — fetch raw content, save to skills folder (requires create permission)
- `remove(name)` — delete skill file from vault (requires delete permission)

---

## Settings

### Full settings structure

```ts
interface LavaClawSettings {
    llm: LLMSettings
    channel: 'telegram'       // only telegram in v1
    telegram: TelegramSettings
    vault: VaultPermissions
    workspacePath: string     // default: '.lava-claw'
}
```

### Settings tab layout

```
Lava Claw Settings
├── General
│   └── Workspace folder path
├── AI Provider
│   ├── Provider              (Gemini — only option in v1)
│   ├── Auth method           (API Key / Gemini CLI)
│   ├── API Key               (shown if API Key selected)
│   ├── Model
│   └── Conversation history  (number of turns, default: 10)
├── Messaging Channel
│   ├── Channel               (Telegram — only option in v1)
│   ├── Enable toggle
│   ├── Bot token
│   ├── Owner user ID         + "Detect my ID" button
│   └── Allowed user IDs      (comma-separated)
├── Vault Permissions
│   ├── Read notes            (toggle, default: on)
│   ├── Create notes          (toggle, default: off)
│   ├── Update notes          (toggle, default: off)
│   └── Delete notes          (toggle, default: off)
└── Skills
    ├── Installed skills list
    └── Add skill button
```

### Settings change reactions

| Setting changed | Action |
|---|---|
| Bot token / channel enabled | `core.restartService('telegram')` |
| API key / auth method / model | `core.restartService('gemini')` |
| Workspace path | `core.restartService('memory')` + `core.restartService('skills')` |
| Vault permissions | No restart — checked at call time |
| Skills | Managed directly by `SkillsService` |

---

## Future / Deferred

- **Additional messaging channels** — WhatsApp, others (implement `MessageSource`)
- **Additional LLM providers** — OpenAI, Anthropic, others (implement `LLMProvider`)
- **SchedulerService** — cron jobs while Obsidian is open (daily summary, Telegram reminders)
- **Multiple chat sessions** — session history browser, named sessions
- **Sub-agents** — explicitly out of scope for v1
- **Mobile support** — mobile users interact via Telegram only

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Option B — layered modules with PluginCore | Clean separation, scalable, matches AGENTS.md guidance |
| Workspace location | `.lava-claw/` at vault root | Hidden folder, operational data separate from user notes |
| Channel switching | Settings UI only | Developer adds code, user upgrades + picks from UI |
| Vault note injection | Automatic (with read permission) | Core value prop — assistant knows the vault |
| Cron jobs | Deferred to future release | YAGNI — keep v1 focused |
| Vault permissions | Global toggles (read/create/update/delete) | Simple, effective, no per-folder complexity in v1 |
| Chat session | In-memory, single session, survives panel close | Simple, no persistence layer needed |
| Telegram auth | Long polling + user ID whitelist | No port forwarding, secure by default |
| LLM streaming | `AsyncIterable<string>` from provider | Consistent interface regardless of provider |
