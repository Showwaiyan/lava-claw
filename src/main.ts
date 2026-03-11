import {Notice, Plugin} from 'obsidian'
import {DEFAULT_SETTINGS, LavaClawSettingTab} from './settings'
import type {LavaClawSettings} from './settings'
import {PluginCore} from './core'

export default class LavaClawPlugin extends Plugin {
	settings: LavaClawSettings
	core: PluginCore

	async onload() {
		await this.loadSettings()
		this.core = new PluginCore(this.app, this.settings)

		this.core.registerChatView(this)

		this.addRibbonIcon('bot', 'Open Lava Claw chat', () => {
			void this.core.openChatView()
		})

		this.addCommand({
			id: 'open-chat',
			name: 'Open chat',
			callback: () => { void this.core.openChatView() },
		})

		this.addCommand({
			id: 'clear-chat',
			name: 'Clear chat',
			callback: () => { this.core.clearHistory() },
		})

		this.addSettingTab(new LavaClawSettingTab(this.app, this))

		try {
			await this.core.init()
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw failed to start: ${msg}`)
		}
	}

	onunload() {
		void this.core.destroy()
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<LavaClawSettings>
		)
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
