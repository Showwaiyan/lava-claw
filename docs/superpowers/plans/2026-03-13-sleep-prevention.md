# Sleep Prevention Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-controlled toggle in settings that spawns `caffeinate -i` on macOS to prevent system sleep while the plugin is running, and kills it immediately when toggled off or when Obsidian closes.

**Architecture:** A new `SleepPreventionService` implements the existing `Service` interface and is registered in `PluginCore` alongside all other services. A `preventSleep: boolean` setting field and a toggle in the settings UI wire it together. `restartService('sleep-prevention')` handles toggle on/off.

**Tech Stack:** TypeScript, Node.js `child_process` (available via `isDesktopOnly: true`), Obsidian Plugin API

---

## Chunk 1: Add SleepPreventionService and wire it up

### Task 1: Create `src/services/sleep-prevention.ts`

**Files:**
- Create: `src/services/sleep-prevention.ts`

- [ ] **Step 1: Create the file with the following content**

```ts
import {Notice} from 'obsidian'
import {platform} from 'os'
import {spawn} from 'child_process'
import type {ChildProcess} from 'child_process'
import type {Service} from '../types'
import type {LavaClawSettings} from '../settings'

export class SleepPreventionService implements Service {
	readonly id = 'sleep-prevention'
	private settings: LavaClawSettings
	private process: ChildProcess | null = null

	constructor(settings: LavaClawSettings) {
		this.settings = settings
	}

	async init(): Promise<void> {
		if (!this.settings.preventSleep) return
		if (platform() !== 'darwin') return

		try {
			this.process = spawn('caffeinate', ['-i'])
			this.process.on('error', () => {
				new Notice('Lava Claw: Failed to prevent sleep.')
				this.process = null
			})
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw: Failed to prevent sleep: ${msg}`)
		}
	}

	async destroy(): Promise<void> {
		if (this.process) {
			try {
				this.process.kill()
			} catch {
				// process may already be dead — ignore
			}
			this.process = null
		}
	}
}
```

- [ ] **Step 2: Run build to verify no type errors**

```bash
npm run build
```

Expected: clean build, zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/sleep-prevention.ts
git commit -m "feat: add SleepPreventionService"
```

---

### Task 2: Add `preventSleep` to settings

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add `preventSleep` to the `LavaClawSettings` interface**

In `src/settings.ts`, find:
```ts
export interface LavaClawSettings {
	llm: LLMSettings
	channel: 'telegram'
	telegram: TelegramSettings
	vault: VaultPermissions
	workspacePath: string
}
```

Replace with:
```ts
export interface LavaClawSettings {
	llm: LLMSettings
	channel: 'telegram'
	telegram: TelegramSettings
	vault: VaultPermissions
	workspacePath: string
	preventSleep: boolean
}
```

- [ ] **Step 2: Add `preventSleep: false` to `DEFAULT_SETTINGS`**

Find:
```ts
export const DEFAULT_SETTINGS: LavaClawSettings = {
	llm: {
```

The full object ends with `workspacePath: '.lava-claw',`. Add the new field after it:

Find:
```ts
	workspacePath: '.lava-claw',
}
```

Replace with:
```ts
	workspacePath: '.lava-claw',
	preventSleep: false,
}
```

- [ ] **Step 3: Add "General" section with toggle to the settings UI**

In `LavaClawSettingTab.display()`, find the first setting (workspace folder path):
```ts
		// ── General ──────────────────────────────────────────────

		new Setting(containerEl)
			.setName('Workspace folder path')
```

Replace with:
```ts
		// ── General ──────────────────────────────────────────────
		new Setting(containerEl).setName('General').setHeading()

		new Setting(containerEl)
			.setName('Prevent system sleep')
			.setDesc('Keep macOS awake while the plugin is running. Has no effect on Windows or Linux.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.preventSleep)
				.onChange(async (value) => {
					this.plugin.settings.preventSleep = value
					await this.plugin.saveSettings()
					await this.plugin.core.restartService('sleep-prevention')
				}))

		new Setting(containerEl)
			.setName('Workspace folder path')
```

- [ ] **Step 4: Run build to verify no type errors**

```bash
npm run build
```

Expected: clean build, zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add preventSleep setting and toggle UI"
```

---

### Task 3: Register `SleepPreventionService` in `PluginCore`

**Files:**
- Modify: `src/core.ts`

- [ ] **Step 1: Import `SleepPreventionService`**

In `src/core.ts`, find:
```ts
import {TelegramService} from './services/telegram'
```

Replace with:
```ts
import {TelegramService} from './services/telegram'
import {SleepPreventionService} from './services/sleep-prevention'
```

- [ ] **Step 2: Add `sleepPrevention` public field**

Find:
```ts
	telegram!: TelegramService
	chatView: ChatView | null = null
```

Replace with:
```ts
	telegram!: TelegramService
	sleepPrevention!: SleepPreventionService
	chatView: ChatView | null = null
```

- [ ] **Step 3: Construct, register, and init the service in `init()`**

Find:
```ts
		const telegram = new TelegramService(
			this.settings,
			this.gemini,
			this.agentRunner,
			this.memory,
			this.saveSettingsFn
		)
		this.registerService(telegram)
		await telegram.init()
		this.telegram = telegram
	}
```

Replace with:
```ts
		const telegram = new TelegramService(
			this.settings,
			this.gemini,
			this.agentRunner,
			this.memory,
			this.saveSettingsFn
		)
		this.registerService(telegram)
		await telegram.init()
		this.telegram = telegram

		const sleepPrevention = new SleepPreventionService(this.settings)
		this.registerService(sleepPrevention)
		await sleepPrevention.init()
		this.sleepPrevention = sleepPrevention
	}
```

- [ ] **Step 4: Run build to verify no type errors**

```bash
npm run build
```

Expected: clean build, zero errors.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: zero warnings or errors.

- [ ] **Step 6: Commit**

```bash
git add src/core.ts
git commit -m "feat: register SleepPreventionService in PluginCore"
```

---

### Task 4: Copy build artifact to vault and verify manually

- [ ] **Step 1: Copy `main.js` to vault**

```bash
cp main.js "/Users/showwaiyan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/lava-claw/main.js"
```

- [ ] **Step 2: Manual verification**

In Obsidian:
1. Disable and re-enable the Lava Claw plugin
2. Open Settings → Lava Claw
3. Confirm a "General" heading appears at the top with a "Prevent system sleep" toggle (default off)
4. Toggle it ON — run `ps aux | grep caffeinate` in a terminal to confirm the process is running
5. Toggle it OFF — confirm `caffeinate` is no longer in `ps aux` output
6. Toggle ON again, then quit Obsidian — confirm `caffeinate` is no longer running after Obsidian exits
