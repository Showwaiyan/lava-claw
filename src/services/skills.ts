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

		// Flat .md files directly in skills/
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

		// Folder-based skills: skills/<name>/SKILL.md
		for (const folderPath of listing.folders) {
			const name = folderPath.slice(this.skillsPath.length + 1)
			const skillFilePath = `${folderPath}/SKILL.md`
			const skillExists = await adapter.exists(skillFilePath)
			if (!skillExists) continue
			try {
				const content = await adapter.read(skillFilePath)
				this.index.set(name, {name, path: skillFilePath, content})
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
		// If skill lives in a subfolder (skills/<name>/SKILL.md), remove the folder
		const expectedFolderFile = `${this.skillsPath}/${name}/SKILL.md`
		if (skill.path === expectedFolderFile) {
			const folderPath = `${this.skillsPath}/${name}`
			const folderFile = this.app.vault.getAbstractFileByPath(folderPath)
			if (folderFile) await this.app.fileManager.trashFile(folderFile)
		} else {
			const file = this.app.vault.getAbstractFileByPath(skill.path)
			if (file) await this.app.fileManager.trashFile(file)
		}
		this.index.delete(name)
	}

	async addSkill(name: string, content: string, useFolder = false): Promise<void> {
		const adapter = this.app.vault.adapter
		let dest: string
		if (useFolder) {
			dest = `${this.skillsPath}/${name}/SKILL.md`
			const folderPath = `${this.skillsPath}/${name}`
			if (!(await adapter.exists(folderPath))) {
				await adapter.mkdir(folderPath)
			}
		} else {
			dest = `${this.skillsPath}/${name}.md`
		}
		await adapter.write(dest, content)
		this.index.set(name, {name, path: dest, content})
	}

	async readSkill(name: string): Promise<string> {
		const skill = this.index.get(name)
		if (!skill) throw new Error(`Skill not found: ${name}`)
		return skill.content
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
