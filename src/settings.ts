import {App, PluginSettingTab, Setting} from 'obsidian'
import type LavaClawPlugin from './main'
import type {VaultPermissions} from './types'

export interface LLMSettings {
	provider: 'gemini'
	authMethod: 'apikey' | 'cli'
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
		provider: 'gemini',
		authMethod: 'apikey',
		apiKey: '',
		model: 'gemini-2.0-flash',
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

// Full settings UI is implemented in Chunk 6.
// This stub satisfies the PluginSettingTab contract in the meantime.
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
			.setName('Settings')
			.setDesc('Full settings coming soon.')
	}
}
