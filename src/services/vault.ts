import {App, FileManager, TFile, Vault} from 'obsidian'
import type {Service, VaultPermissions} from '../types'
import {PermissionError} from '../types'
import type {LavaClawSettings} from '../settings'

export class VaultService implements Service {
	readonly id = 'vault'
	private app: App
	private settings: LavaClawSettings

	constructor(app: App, settings: LavaClawSettings) {
		this.app = app
		this.settings = settings
	}

	private get vault(): Vault {
		return this.app.vault
	}

	private get fileManager(): FileManager {
		return this.app.fileManager
	}

	private get permissions(): VaultPermissions {
		return this.settings.vault
	}

	async init(): Promise<void> {
		// no-op
	}

	async destroy(): Promise<void> {
		// no-op
	}

	async searchRelevant(query: string): Promise<string> {
		if (!this.permissions.read) return ''

		const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
		if (tokens.length === 0) return ''

		const files = this.vault.getMarkdownFiles()
		const scored: Array<{file: TFile; score: number}> = []

		for (const file of files) {
			// Skip .lava-claw workspace files
			if (file.path.startsWith(this.settings.workspacePath)) continue

			try {
				const content = await this.vault.cachedRead(file)
				const lower = content.toLowerCase()
				const score = tokens.reduce((acc, t) => {
					const matches = lower.split(t).length - 1
					return acc + matches
				}, 0)
				if (score > 0) scored.push({file, score})
			} catch {
				// unreadable file — skip
			}
		}

		scored.sort((a, b) => b.score - a.score)
		const top = scored.slice(0, 5)

		if (top.length === 0) return ''

		const parts = await Promise.all(
			top.map(async ({file}) => {
				const content = await this.vault.cachedRead(file)
				// Truncate very large notes to avoid bloating the prompt
				const truncated = content.length > 2000
					? content.slice(0, 2000) + '\n...(truncated)'
					: content
				return `### ${file.basename}\n${truncated}`
			})
		)
		return parts.join('\n\n')
	}

	async readNote(path: string): Promise<string> {
		if (!this.permissions.read) throw new PermissionError('read')
		return this.vault.adapter.read(path)
	}

	async createNote(path: string, content: string): Promise<void> {
		if (!this.permissions.create) throw new PermissionError('create')
		await this.vault.create(path, content)
	}

	async updateNote(path: string, content: string): Promise<void> {
		if (!this.permissions.update) throw new PermissionError('update')
		const file = this.vault.getFileByPath(path)
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`)
		await this.vault.modify(file, content)
	}

	async appendNote(path: string, content: string): Promise<void> {
		if (!this.permissions.update) throw new PermissionError('update')
		const file = this.vault.getFileByPath(path)
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`)
		const existing = await this.vault.read(file)
		await this.vault.modify(file, existing + '\n' + content)
	}

	async patchNote(path: string, oldString: string, newString: string): Promise<void> {
		if (!this.permissions.update) throw new PermissionError('update')
		const file = this.vault.getFileByPath(path)
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`)
		const existing = await this.vault.read(file)
		if (!existing.includes(oldString)) throw new Error(`String not found in note: ${path}`)
		await this.vault.modify(file, existing.replace(oldString, newString))
	}

	async writeNote(path: string, content: string): Promise<void> {
		const file = this.vault.getFileByPath(path)
		if (file instanceof TFile) {
			if (!this.permissions.update) throw new PermissionError('update')
			await this.vault.modify(file, content)
		} else {
			if (!this.permissions.create) throw new PermissionError('create')
			await this.vault.create(path, content)
		}
	}

	async deleteNote(path: string): Promise<void> {
		if (!this.permissions.delete) throw new PermissionError('delete')
		const file = this.vault.getFileByPath(path)
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`)
		await this.fileManager.trashFile(file)
	}

	async moveNote(path: string, newPath: string): Promise<void> {
		if (!this.permissions.update) throw new PermissionError('update')
		const file = this.vault.getFileByPath(path)
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`)
		await this.fileManager.renameFile(file, newPath)
	}

	async copyNote(path: string, newPath: string): Promise<void> {
		if (!this.permissions.read) throw new PermissionError('read')
		if (!this.permissions.create) throw new PermissionError('create')
		const content = await this.vault.adapter.read(path)
		await this.vault.create(newPath, content)
	}

	async createFolder(path: string): Promise<void> {
		if (!this.permissions.create) throw new PermissionError('create')
		const exists = await this.vault.adapter.exists(path)
		if (exists) throw new Error(`Folder already exists: ${path}`)
		await this.vault.adapter.mkdir(path)
	}

	async deleteFolder(path: string): Promise<void> {
		if (!this.permissions.delete) throw new PermissionError('delete')
		const folder = this.vault.getFolderByPath(path)
		if (!folder) throw new Error(`Folder not found: ${path}`)
		await this.vault.delete(folder, true)
	}
}
