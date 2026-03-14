import {App, Modal, Notice, PluginSettingTab, Setting} from 'obsidian'
import type LavaClawPlugin from './main'
import type {VaultPermissions} from './types'

export interface LLMSettings {
	enabled: boolean
	provider: 'gemini'
	apiKey: string
	model: string
	historyLength: number
}

export interface TelegramSettings {
	enabled: boolean
	botToken: string
	ownerUserId: string
	ownerChatId: string
	allowedUserIds: string[]
}

export interface LavaClawSettings {
	llm: LLMSettings
	channel: 'telegram'
	telegram: TelegramSettings
	vault: VaultPermissions
	workspacePath: string
}

export const DEFAULT_SETTINGS: LavaClawSettings = {
	llm: {
		enabled: false,
		provider: 'gemini',
		apiKey: '',
		model: 'gemini-2.5-flash',
		historyLength: 10,
	},
	channel: 'telegram',
	telegram: {
		enabled: false,
		botToken: '',
		ownerUserId: '',
		ownerChatId: '',
		allowedUserIds: [],
	},
	vault: {
		read: true,
		create: false,
		update: false,
		delete: false,
	},
	workspacePath: '.lava-claw',
}

class GitHubSkillModal extends Modal {
	private onSubmit: (url: string, name: string) => void

	constructor(app: App, onSubmit: (url: string, name: string) => void) {
		super(app)
		this.onSubmit = onSubmit
	}

	onOpen(): void {
		let url = '', skillName = ''
		this.contentEl.createEl('h3', {text: 'Add skill from GitHub'})
		new Setting(this.contentEl).setName('GitHub URL').addText(t => t.onChange(v => { url = v }))
		new Setting(this.contentEl).setName('Skill name').addText(t => t.onChange(v => { skillName = v }))
		new Setting(this.contentEl).addButton(btn => btn
			.setButtonText('Install')
			.setCta()
			.onClick(() => { this.close(); this.onSubmit(url, skillName) }))
	}

	onClose(): void {
		this.contentEl.empty()
	}
}

export class LavaClawSettingTab extends PluginSettingTab {
	plugin: LavaClawPlugin

	constructor(app: App, plugin: LavaClawPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const {containerEl} = this
		containerEl.empty()

		new Setting(containerEl)
			.setName('Workspace folder path')
			.setDesc('Hidden folder at vault root where Lava Claw stores its files.')
			.addText(text => text
				.setPlaceholder('.lava-claw')
				.setValue(this.plugin.settings.workspacePath)
				.onChange(async (value) => {
					this.plugin.settings.workspacePath = value || '.lava-claw'
					await this.plugin.saveSettings()
					await this.plugin.core.restartService('memory')
					void this.plugin.core.restartService('skills')
				}))

		// ── AI providers ───────────────────────────────────────────
		new Setting(containerEl).setName('AI providers').setHeading()

		new Setting(containerEl)
			.setName('Enable Gemini')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.llm.enabled)
				.onChange(async (value) => {
					this.plugin.settings.llm.enabled = value
					if (!value) {
						this.plugin.settings.llm.apiKey = ''
					}
					await this.plugin.saveSettings()
					this.display()
				}))

		if (this.plugin.settings.llm.enabled) {
			new Setting(containerEl)
				.setName('API key')
				.addText(text => text
					.setPlaceholder('AIza...')
					.setValue(this.plugin.settings.llm.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.llm.apiKey = value
						await this.plugin.saveSettings()
					}))

			new Setting(containerEl)
			.setName('Model')
			.addText(text => text
				.setPlaceholder(`gemini-2.0-flash${''}`)
				.setValue(this.plugin.settings.llm.model)
				.onChange(async (value) => {
						this.plugin.settings.llm.model = value
						await this.plugin.saveSettings()
						void this.plugin.core.restartService('gemini')
					}))

			new Setting(containerEl)
				.setName('Conversation history length')
				.setDesc('Number of past turns to include in each prompt.')
				.addSlider(slider => slider
					.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.llm.historyLength)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.llm.historyLength = value
						await this.plugin.saveSettings()
					}))
		}

		// ── Messaging channels ─────────────────────────────────────
		new Setting(containerEl).setName('Messaging channels').setHeading()

		new Setting(containerEl)
			.setName('Enable Telegram')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.telegram.enabled)
				.onChange(async (value) => {
					this.plugin.settings.telegram.enabled = value
					await this.plugin.saveSettings()
					void this.plugin.core.restartService('telegram')
					this.display()
				}))

		if (this.plugin.settings.telegram.enabled) {
			new Setting(containerEl)
				.setName('Bot token')
				.setDesc('Get from @BotFather on Telegram.')
				.addText(text => text
					.setPlaceholder(`123456:ABC-...${''}`)
					.setValue(this.plugin.settings.telegram.botToken)
					.onChange(async (value) => {
						this.plugin.settings.telegram.botToken = value
						await this.plugin.saveSettings()
					}))

			new Setting(containerEl)
				.setName('Owner Telegram user ID')
				.setDesc('Your Telegram user ID. Used to authorize messages.')
				.addText(text => text
					.setPlaceholder('123456789')
					.setValue(this.plugin.settings.telegram.ownerUserId)
					.onChange(async (value) => {
						this.plugin.settings.telegram.ownerUserId = value
						await this.plugin.saveSettings()
					}))
				.addButton(btn => btn
					.setButtonText('Detect my ID')
					.onClick(() => {
						new Notice('Send any message to your bot to detect your ID.')
						this.plugin.core.telegram.startDetectMode((userId) => {
							void (async () => {
								this.plugin.settings.telegram.ownerUserId = userId
								await this.plugin.saveSettings()
								new Notice(`Telegram user ID detected: ${userId}`)
								this.display()
							})()
						})
					}))

			new Setting(containerEl)
				.setName('Allowed user IDs')
				.setDesc('Comma-separated Telegram user IDs allowed to use the bot (besides owner).')
				.addText(text => text
					.setPlaceholder('111,222,333')
					.setValue(this.plugin.settings.telegram.allowedUserIds.join(','))
					.onChange(async (value) => {
						this.plugin.settings.telegram.allowedUserIds = value
							.split(',')
							.map(s => s.trim())
							.filter(s => s.length > 0)
						await this.plugin.saveSettings()
					}))
		}

		// ── Vault permissions ─────────────────────────────────────
		new Setting(containerEl).setName('Vault permissions').setHeading()

		const permDefs: Array<{key: keyof VaultPermissions; name: string; desc: string}> = [
			{key: 'read', name: 'Read notes', desc: 'Allow AI to read and search vault notes for context.'},
			{key: 'create', name: 'Create notes', desc: 'Allow AI to create new notes in the vault.'},
			{key: 'update', name: 'Update notes', desc: 'Allow AI to modify existing notes.'},
			{key: 'delete', name: 'Delete notes', desc: 'Allow AI to delete notes.'},
		]

		for (const {key, name, desc} of permDefs) {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.vault[key])
					.onChange(async (value) => {
						this.plugin.settings.vault[key] = value
						await this.plugin.saveSettings()
					}))
		}

		// ── Skills ────────────────────────────────────────────────
		new Setting(containerEl).setName('Skills').setHeading()

		const skills = this.plugin.core.skills.listSkills()
		if (skills.length === 0) {
			containerEl.createEl('p', {
				text: 'No skills installed.',
				cls: 'setting-item-description',
			})
		}

		for (const skill of skills) {
			new Setting(containerEl)
				.setName(skill.name)
				.addButton(btn => btn
					.setButtonText('Remove')
					.setWarning()
					.onClick(() => {
						void this.plugin.core.skills.remove(skill.name).then(() => { this.display() })
					}))
		}

		new Setting(containerEl)
			.setName('Add skill')
			.addButton(btn => btn
				.setButtonText('From file')
				.onClick(() => { this.openAddSkillFromFile() }))
			.addButton(btn => btn
				.setButtonText('From GitHub')
				.onClick(() => { this.openAddSkillFromGitHub() }))
	}

	private openAddSkillFromFile(): void {
		interface ElectronDialog {
			showOpenDialog(opts: {properties: string[]; filters: {name: string; extensions: string[]}[]}): Promise<{canceled: boolean; filePaths: string[]}>
		}
		interface ElectronRemote {
			dialog: ElectronDialog
		}
		const electronModule = (globalThis as unknown as {require?: (m: string) => unknown}).require?.('electron') as {remote: ElectronRemote} | undefined
		if (!electronModule) return
		void electronModule.remote.dialog.showOpenDialog({
			properties: ['openFile'],
			filters: [{name: 'Markdown', extensions: ['md']}],
		}).then(async (result) => {
			if (result.canceled || !result.filePaths[0]) return
			const filePath = result.filePaths[0]
			const name = filePath.split('/').pop()?.replace(/\.md$/, '') ?? 'skill'
			await this.plugin.core.skills.installFromFile(filePath, name)
			new Notice(`Skill '${name}' installed.`)
			this.display()
		})
	}

	private openAddSkillFromGitHub(): void {
		new GitHubSkillModal(this.app, (url, name) => {
			void (async () => {
				if (!url || !name) return
				await this.plugin.core.skills.installFromGitHub(url, name)
				new Notice(`Skill '${name}' installed.`)
				this.display()
			})()
		}).open()
	}
}
