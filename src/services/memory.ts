import {App, Notice, Vault} from 'obsidian'
import type {Service, ConversationTurn} from '../types'
import type {LavaClawSettings} from '../settings'

const DEFAULT_TOOLS_CONTENT = `# Tools

You have the following capabilities (subject to user permissions):
- Read vault notes (read_note, search_notes)
- Create new vault notes (create_note)
- Update existing vault notes (update_note)
- Delete vault notes (delete_note)
- Read and write your identity files (read_workspace_file, write_workspace_file)
- Update long-term memory (update_memory)
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

	async isFirstRun(): Promise<boolean> {
		const path = `${this.workspacePath}/SOUL.md`
		try {
			const content = await this.vault.adapter.read(path)
			return content.trim() === ''
		} catch {
			return true
		}
	}

	private async ensureWorkspace(): Promise<void> {
		const base = this.workspacePath
		const adapter = this.vault.adapter

		const exists = await adapter.exists(base)
		if (!exists) {
			await adapter.mkdir(base)
			await adapter.mkdir(`${base}/memory`)
			await adapter.mkdir(`${base}/skills`)
			await adapter.write(`${base}/SOUL.md`, '')
			await adapter.write(`${base}/IDENTITY.md`, '')
			await adapter.write(`${base}/USER.md`, '')
			await adapter.write(`${base}/TOOLS.md`, DEFAULT_TOOLS_CONTENT)
			await adapter.write(`${base}/memory.md`, '')
			new Notice('Initialized. Configure your AI provider and messaging channel in settings to get started.')
			return
		}

		// Ensure subdirectories exist even if base folder was created manually
		if (!(await adapter.exists(`${base}/memory`))) await adapter.mkdir(`${base}/memory`)
		if (!(await adapter.exists(`${base}/skills`))) await adapter.mkdir(`${base}/skills`)
		if (!(await adapter.exists(`${base}/memory.md`))) await adapter.write(`${base}/memory.md`, '')
		if (!(await adapter.exists(`${base}/SOUL.md`))) await adapter.write(`${base}/SOUL.md`, '')
		if (!(await adapter.exists(`${base}/IDENTITY.md`))) await adapter.write(`${base}/IDENTITY.md`, '')
		if (!(await adapter.exists(`${base}/USER.md`))) await adapter.write(`${base}/USER.md`, '')
		if (!(await adapter.exists(`${base}/TOOLS.md`))) await adapter.write(`${base}/TOOLS.md`, DEFAULT_TOOLS_CONTENT)
	}

	async getContext(): Promise<string> {
		const base = this.workspacePath
		const adapter = this.vault.adapter

		if (await this.isFirstRun()) {
			return [
				'You have not yet been given an identity.',
				'When the user sends their first message, do not answer their question directly yet.',
				'Instead, introduce yourself warmly as an unnamed assistant and start a short natural conversation to learn:',
				'what the user would like to call you, a bit about who they are and what to call them,',
				'and what kind of assistant they want you to be.',
				'Ask one or two questions at a time — keep it conversational, not a form.',
				'Once you have gathered enough to write a meaningful identity, use the write_workspace_file tool to write',
				'your personality and name to SOUL.md, your structured fields to IDENTITY.md, and the user\'s info to USER.md.',
				'After writing the files, acknowledge you are ready and offer to help with anything.',
			].join(' ')
		}

		const parts: string[] = []

		const tryRead = async (label: string, file: string, omitIfEmpty = false): Promise<void> => {
			try {
				const content = await adapter.read(`${base}/${file}`)
				if (omitIfEmpty && !content.trim()) return
				parts.push(`## ${label}\n${content}`)
			} catch {
				// file missing — skip
			}
		}

		await tryRead('Identity (SOUL.md)', 'SOUL.md')
		await tryRead('Identity fields (IDENTITY.md)', 'IDENTITY.md')
		await tryRead('About the user (USER.md)', 'USER.md')
		await tryRead('Tools', 'TOOLS.md')
		await tryRead('Long-term memory', 'memory.md', true)

		const today = this.todayPath()
		try {
			const daily = await adapter.read(today)
			if (daily.trim()) parts.push(`## Today's conversation log\n${daily}`)
		} catch {
			// no log yet today — skip
		}

		parts.push(
			'If the user shares personal information or preferences not already captured in USER.md, ' +
			'use write_workspace_file to update it. ' +
			'If your own identity or personality evolves through conversation, update SOUL.md accordingly.'
		)

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

	async readWorkspaceFile(filename: string): Promise<string> {
		const path = `${this.workspacePath}/${filename}`
		return this.vault.adapter.read(path)
	}

	async writeWorkspaceFile(filename: string, content: string): Promise<void> {
		const path = `${this.workspacePath}/${filename}`
		await this.vault.adapter.write(path, content)
	}

	async readDailyLog(date: string): Promise<string> {
		// date format: YYYY-MM-DD
		const path = `${this.workspacePath}/memory/${date}.md`
		return this.vault.adapter.read(path)
	}

	private todayPath(): string {
		const d = new Date()
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		return `${this.workspacePath}/memory/${yyyy}-${mm}-${dd}.md`
	}
}
