import {App} from 'obsidian'
import type {Service, MessageSource, ConversationTurn} from './types'
import type {LavaClawSettings} from './settings'
import {MemoryService} from './services/memory'
import {VaultService} from './services/vault'
import {SkillsService} from './services/skills'
import {GeminiService} from './services/gemini'
import {OpenCodeService} from './services/opencode'
import {AgentRunner} from './services/agent-runner'
import {TelegramService} from './services/telegram'
import {ChatView, CHAT_VIEW_TYPE} from './ui/chat-view'
import {ToolRegistry} from './tools/index'
import type {ToolContext} from './tools/index'
import {registerVaultTools} from './tools/vault'
import {registerWorkspaceTools} from './tools/workspace'
import {registerMemoryTools} from './tools/memory'
import {registerSkillsTools} from './tools/skills'

export class PluginCore {
	private app: App
	private settings: LavaClawSettings
	private saveSettingsFn: () => Promise<void>
	private services: Service[] = []
	private chatSession: import('@google/generative-ai').ChatSession | null = null
	private opencodeSession: import('./types').LLMSession | null = null
	private toolRegistry: ToolRegistry = new ToolRegistry()
	memory!: MemoryService
	vault!: VaultService
	skills!: SkillsService
	gemini!: GeminiService
	opencode!: OpenCodeService
	agentRunner!: AgentRunner
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

		const opencode = new OpenCodeService(this.settings)
		this.registerService(opencode)
		await opencode.init()
		this.opencode = opencode

		// Register tools
		registerVaultTools(this.toolRegistry)
		registerWorkspaceTools(this.toolRegistry)
		registerMemoryTools(this.toolRegistry)
		registerSkillsTools(this.toolRegistry)
		gemini.setToolDeclarations(this.toolRegistry.getDefinitions())
		opencode.setToolDeclarations(this.toolRegistry.getDefinitions())

		// Build tool context
		const toolCtx: ToolContext = {
			app: this.app,
			vault: this.vault,
			memory: this.memory,
			skills: this.skills,
			settings: this.settings,
		}

		// Create AgentRunner (stateless, shared between channels)
		this.agentRunner = new AgentRunner(this.toolRegistry, toolCtx)

		this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE)

		const telegram = new TelegramService(
			this.settings,
			this.gemini,
			this.opencode,
			this.agentRunner,
			this.memory,
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
		const provider = this.settings.llm.provider
		const systemPrompt = await this.memory.getContext()

		let session: import('./types').LLMSession
		if (provider === 'opencode') {
			if (!this.opencodeSession) {
				this.opencodeSession = this.opencode.createSession(systemPrompt)
			}
			session = this.opencodeSession
		} else {
			if (!this.chatSession) {
				this.chatSession = this.gemini.createSession(systemPrompt)
			}
			session = this.chatSession as unknown as import('./types').LLMSession
		}

		// Add user turn to daily log
		const userTurn: ConversationTurn = {
			role: 'user',
			content: text,
			timestamp: Date.now(),
		}
		await this.memory.appendToDaily(userTurn)

		try {
			const response = await this.agentRunner.run(
				session,
				text,
				(name) => source.showToolStatus?.(name, 'running'),
				(name) => source.showToolStatus?.(name, 'done'),
				(name, err) => source.showToolStatus?.(name, 'error', err),
			)

			const assistantTurn: ConversationTurn = {
				role: 'assistant',
				content: response,
				timestamp: Date.now(),
			}
			await source.reply(assistantTurn)
			await this.memory.appendToDaily(assistantTurn)

			// Extract important information to memory.md (internal, not shown to user)
			void this.agentRunner.extractMemory(session).catch(() => { /* ignore */ })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			const errorTurn: ConversationTurn = {
				role: 'assistant',
				content: `Error: ${msg}`,
				timestamp: Date.now(),
			}
			await source.reply(errorTurn)
		}
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
		this.chatSession = null
		this.opencodeSession = null
	}

	getOpenCodeService(): OpenCodeService {
		const idx = this.services.findIndex(
			(s) => (s as unknown as {id?: string}).id === 'opencode'
		)
		if (idx === -1) return null as unknown as OpenCodeService
		return this.services[idx] as OpenCodeService
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

	getGeminiService(): GeminiService {
		const idx = this.services.findIndex(
			(s) => (s as unknown as {id?: string}).id === 'gemini'
		)
		if (idx === -1) return null as unknown as GeminiService
		return this.services[idx] as GeminiService
	}

	protected registerService(svc: Service): void {
		this.services.push(svc)
	}
}
