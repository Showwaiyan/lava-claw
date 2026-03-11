import {App} from 'obsidian'
import type {Service, MessageSource, ConversationTurn, Prompt} from './types'
import type {LavaClawSettings} from './settings'
import {MemoryService} from './services/memory'
import {VaultService} from './services/vault'
import {SkillsService} from './services/skills'
import {GeminiService} from './services/gemini'

export class PluginCore {
	private app: App
	private settings: LavaClawSettings
	private services: Service[] = []
	private history: ConversationTurn[] = []
	memory!: MemoryService
	vault!: VaultService
	skills!: SkillsService
	gemini!: GeminiService

	constructor(app: App, settings: LavaClawSettings) {
		this.app = app
		this.settings = settings
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
		const chunks = this.gemini.complete(prompt)

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

	clearHistory(): void {
		this.history = []
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
