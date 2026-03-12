import {App} from 'obsidian'
import type {Service, MessageSource, ConversationTurn, Prompt} from './types'
import type {LavaClawSettings} from './settings'
import {MemoryService} from './services/memory'
import {VaultService} from './services/vault'
import {SkillsService} from './services/skills'
import {GeminiService} from './services/gemini'
import {TelegramService} from './services/telegram'
import {ChatView, CHAT_VIEW_TYPE} from './ui/chat-view'
import {ToolRegistry} from './tools/index'
import type {ToolContext} from './tools/index'
import {registerVaultTools} from './tools/vault'
import {registerWorkspaceTools} from './tools/workspace'
import {registerMemoryTools} from './tools/memory'

export class PluginCore {
	private app: App
	private settings: LavaClawSettings
	private saveSettingsFn: () => Promise<void>
	private services: Service[] = []
	private history: ConversationTurn[] = []
	private toolRegistry: ToolRegistry = new ToolRegistry()
	memory!: MemoryService
	vault!: VaultService
	skills!: SkillsService
	gemini!: GeminiService
	telegram!: TelegramService
	chatView: ChatView | null = null

	constructor(app: App, settings: LavaClawSettings, saveSettings: () => Promise<void>) {
		this.app = app
		this.settings = settings
		this.saveSettingsFn = saveSettings
	}

	async init(): Promise<void> {
		const memory = new MemoryService(this.app, this.settings)
		this.registerService(memory)
		await memory.init()
		this.memory = memory

		const vault = new VaultService(this.app, this.settings)
		this.registerService(vault)
		await vault.init()
		this.vault = vault

		const skills = new SkillsService(this.app, this.settings)
		this.registerService(skills)
		await skills.init()
		this.skills = skills

		const gemini = new GeminiService(this.settings)
		this.registerService(gemini)
		await gemini.init()
		this.gemini = gemini

		// Register tools
		registerVaultTools(this.toolRegistry)
		registerWorkspaceTools(this.toolRegistry)
		registerMemoryTools(this.toolRegistry)
		this.gemini.setTools(this.toolRegistry.getDefinitions())

		this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE)

		const telegram = new TelegramService(
			this.settings,
			(text, source) => this.handleMessage(text, source),
			this.saveSettingsFn
		)
		this.registerService(telegram)
		await telegram.init()
		this.telegram = telegram
	}

	async destroy(): Promise<void> {
		for (const svc of [...this.services].reverse()) {
			await svc.destroy()
		}
		this.services = []
	}

	async handleMessage(text: string, source: MessageSource): Promise<void> {
		// Parse /skill command prefix
		let skillContent: string | null = null
		let messageText = text
		const skillMatch = text.match(/^\/skill\s+(\S+)\s*([\s\S]*)$/)
		if (skillMatch) {
			const skillName = skillMatch[1] ?? ''
			messageText = skillMatch[2]?.trim() || text
			skillContent = this.skills.resolveSkill(skillName)
		}

		// Build context
		const memoryContext = await this.memory.getContext()
		const vaultContext = await this.vault.searchRelevant(messageText)

		const prompt: Prompt = {
			system: memoryContext,
			memory: '',
			vaultContext,
			skills: skillContent ? [skillContent] : [],
			history: this.history.slice(-this.settings.llm.historyLength),
			message: messageText,
		}

		// Add user turn to history
		const userTurn: ConversationTurn = {
			role: 'user',
			content: messageText,
			timestamp: Date.now(),
		}
		this.history.push(userTurn)
		await this.memory.appendToDaily(userTurn)

		// Stream response
		let fullResponse = ''
		const toolCtx: ToolContext & {_registry: ToolRegistry} = {
			vault: this.vault,
			memory: this.memory,
			settings: this.settings,
			_registry: this.toolRegistry,
		}

		const chunks = this.gemini.complete(
			prompt,
			(name) => source.showToolStatus?.(name, 'running'),
			(name) => source.showToolStatus?.(name, 'done'),
			(name, err) => source.showToolStatus?.(name, 'error', err),
			toolCtx,
		)

		// Yield first partial turn so UI can start rendering
		const partialTurn: ConversationTurn = {
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
		}
		await source.reply(partialTurn)

		for await (const chunk of chunks) {
			fullResponse += chunk
			partialTurn.content = fullResponse
			await source.reply(partialTurn)
		}

		// Record complete assistant turn
		const assistantTurn: ConversationTurn = {
			role: 'assistant',
			content: fullResponse,
			timestamp: Date.now(),
		}
		this.history.push(assistantTurn)
		await this.memory.appendToDaily(assistantTurn)
	}

	registerChatView(plugin: import('obsidian').Plugin): void {
		plugin.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => new ChatView(leaf, this)
		)
	}

	async openChatView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
		if (existing.length > 0) {
			const leaf = existing[0]
			if (leaf) void this.app.workspace.revealLeaf(leaf)
			return
		}
		const leaf = this.app.workspace.getRightLeaf(false)
		if (!leaf) return
		await leaf.setViewState({type: CHAT_VIEW_TYPE, active: true})
		void this.app.workspace.revealLeaf(leaf)
	}

	clearHistory(): void {
		this.history = []
		this.gemini.resetSession()
	}

	getHistory(): ConversationTurn[] {
		return this.history
	}

	updateSettings(settings: LavaClawSettings): void {
		this.settings = settings
	}

	async restartService(id: string): Promise<void> {
		const idx = this.services.findIndex(
			(s) => (s as unknown as {id?: string}).id === id
		)
		if (idx === -1) return
		const svc = this.services[idx]
		if (svc === undefined) return
		await svc.destroy()
		await svc.init()
	}

	protected registerService(svc: Service): void {
		this.services.push(svc)
	}
}
