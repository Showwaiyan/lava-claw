import {App, requestUrl} from 'obsidian'
import * as fs from 'fs'
import type {Service, SkillFile} from '../types'
import type {LavaClawSettings} from '../settings'

export class SkillsService implements Service {
	readonly id = 'skills'
	private app: App
	private settings: LavaClawSettings
	private index: Map<string, SkillFile> = new Map()

	constructor(app: App, settings: LavaClawSettings) {
		this.app = app
		this.settings = settings
	}

	private get skillsPath(): string {
		return `${this.settings.workspacePath}/skills`
	}

	async init(): Promise<void> {
		await this.reindex()
	}

	async destroy(): Promise<void> {
		this.index.clear()
	}

	async reindex(): Promise<void> {
		this.index.clear()
		const adapter = this.app.vault.adapter
		const exists = await adapter.exists(this.skillsPath)
		if (!exists) return

		const listing = await adapter.list(this.skillsPath)
		for (const filePath of listing.files) {
			if (!filePath.endsWith('.md')) continue
			const name = filePath
				.slice(this.skillsPath.length + 1)
				.replace(/\.md$/, '')
			try {
				const content = await adapter.read(filePath)
				this.index.set(name, {name, path: filePath, content})
			} catch {
				// unreadable — skip
			}
		}
	}

	listSkills(): SkillFile[] {
		return Array.from(this.index.values())
	}

	resolveSkill(name: string): string | null {
		return this.index.get(name)?.content ?? null
	}

	async installFromFile(absolutePath: string, name: string): Promise<void> {
		const content = fs.readFileSync(absolutePath, 'utf8')
		const dest = `${this.skillsPath}/${name}.md`
		await this.app.vault.adapter.write(dest, content)
		this.index.set(name, {name, path: dest, content})
	}

	async installFromGitHub(url: string, name: string): Promise<void> {
		const rawUrl = this.toRawGitHubUrl(url)
		const response = await requestUrl({url: rawUrl})
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Failed to fetch skill from GitHub: ${response.status}`)
		}
		const content = response.text
		const dest = `${this.skillsPath}/${name}.md`
		await this.app.vault.adapter.write(dest, content)
		this.index.set(name, {name, path: dest, content})
	}

	async remove(name: string): Promise<void> {
		const skill = this.index.get(name)
		if (!skill) return
		await this.app.vault.adapter.remove(skill.path)
		this.index.delete(name)
	}

	private toRawGitHubUrl(url: string): string {
		// Convert github.com blob URLs to raw.githubusercontent.com
		// e.g. https://github.com/user/repo/blob/main/file.md
		//   → https://raw.githubusercontent.com/user/repo/main/file.md
		return url
			.replace('https://github.com/', 'https://raw.githubusercontent.com/')
			.replace('/blob/', '/')
	}
}
