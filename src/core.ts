import {App} from 'obsidian'
import type {Service, MessageSource, ConversationTurn} from './types'
import type {LavaClawSettings} from './settings'
import {MemoryService} from './services/memory'

export class PluginCore {
	private app: App
	private settings: LavaClawSettings
	private services: Service[] = []
	private history: ConversationTurn[] = []
	memory!: MemoryService

	constructor(app: App, settings: LavaClawSettings) {
		this.app = app
		this.settings = settings
	}

	async init(): Promise<void> {
		const memory = new MemoryService(this.app, this.settings)
		this.registerService(memory)
		await memory.init()
		this.memory = memory
	}

	async destroy(): Promise<void> {
		for (const svc of [...this.services].reverse()) {
			await svc.destroy()
		}
		this.services = []
	}

	async handleMessage(text: string, source: MessageSource): Promise<void> {
		// Full implementation in Chunk 4 (message routing).
		// Stub: echo back for now.
		const turn: ConversationTurn = {
			role: 'assistant',
			content: `(echo) ${text}`,
			timestamp: Date.now(),
		}
		await source.reply(turn)
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
