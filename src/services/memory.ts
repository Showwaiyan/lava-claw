import {App, Notice, Vault} from 'obsidian'
import type {Service, ConversationTurn} from '../types'
import type {LavaClawSettings} from '../settings'

const DEFAULT_SOUL = `# Soul

You are Lava Claw, a personal AI assistant embedded in Obsidian.
You are helpful, concise, and thoughtful.
You have access to the user's vault and can read notes to provide context-aware assistance.
`

const DEFAULT_TOOLS = `# Tools

You have the following capabilities (subject to user permissions):
- Read vault notes
- Create new vault notes (if permitted)
- Update existing vault notes (if permitted)
- Delete vault notes (if permitted)
- Answer questions using vault context
- Remember facts via memory.md
`

export class MemoryService implements Service {
	readonly id = 'memory'
	private app: App
	private settings: LavaClawSettings

	constructor(app: App, settings: LavaClawSettings) {
		this.app = app
		this.settings = settings
	}

	private get workspacePath(): string {
		return this.settings.workspacePath
	}

	private get vault(): Vault {
		return this.app.vault
	}

	async init(): Promise<void> {
		await this.ensureWorkspace()
	}

	async destroy(): Promise<void> {
		// no-op
	}

	private async ensureWorkspace(): Promise<void> {
		const base = this.workspacePath
		const adapter = this.vault.adapter

		const exists = await adapter.exists(base)
		if (!exists) {
			await adapter.mkdir(base)
			await adapter.mkdir(`${base}/memory`)
			await adapter.mkdir(`${base}/skills`)
			await adapter.write(`${base}/SOUL.md`, DEFAULT_SOUL)
			await adapter.write(`${base}/TOOLS.md`, DEFAULT_TOOLS)
			await adapter.write(`${base}/memory.md`, '')
			new Notice('Initialized. Configure your AI provider and messaging channel in settings to get started.')
			return
		}

		// Ensure subdirectories exist even if base folder was created manually
		if (!(await adapter.exists(`${base}/memory`))) {
			await adapter.mkdir(`${base}/memory`)
		}
		if (!(await adapter.exists(`${base}/skills`))) {
			await adapter.mkdir(`${base}/skills`)
		}
		if (!(await adapter.exists(`${base}/memory.md`))) {
			await adapter.write(`${base}/memory.md`, '')
		}
		if (!(await adapter.exists(`${base}/SOUL.md`))) {
			await adapter.write(`${base}/SOUL.md`, DEFAULT_SOUL)
		}
		if (!(await adapter.exists(`${base}/TOOLS.md`))) {
			await adapter.write(`${base}/TOOLS.md`, DEFAULT_TOOLS)
		}
	}

	async getContext(): Promise<string> {
		const base = this.workspacePath
		const adapter = this.vault.adapter
		const parts: string[] = []

		try {
			const soul = await adapter.read(`${base}/SOUL.md`)
			parts.push(`## Identity\n${soul}`)
		} catch {
			// file missing — skip
		}

		try {
			const tools = await adapter.read(`${base}/TOOLS.md`)
			parts.push(`## Tools\n${tools}`)
		} catch {
			// file missing — skip
		}

		try {
			const memory = await adapter.read(`${base}/memory.md`)
			if (memory.trim()) {
				parts.push(`## Long-term memory\n${memory}`)
			}
		} catch {
			// file missing — skip
		}

		const today = this.todayPath()
		try {
			const daily = await adapter.read(today)
			if (daily.trim()) {
				parts.push(`## Today's conversation log\n${daily}`)
			}
		} catch {
			// no log yet today — skip
		}

		return parts.join('\n\n')
	}

	async appendToDaily(turn: ConversationTurn): Promise<void> {
		const path = this.todayPath()
		const adapter = this.vault.adapter
		const timestamp = new Date(turn.timestamp).toISOString()
		const line = `\n**${turn.role}** (${timestamp})\n${turn.content}\n`

		const existing = await adapter.exists(path)
			? await adapter.read(path)
			: ''
		await adapter.write(path, existing + line)
	}

	async updateMemory(content: string): Promise<void> {
		const path = `${this.workspacePath}/memory.md`
		await this.vault.adapter.write(path, content)
	}

	private todayPath(): string {
		const d = new Date()
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		return `${this.workspacePath}/memory/${yyyy}-${mm}-${dd}.md`
	}
}
