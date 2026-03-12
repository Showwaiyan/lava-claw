import {Notice} from 'obsidian'
import {Bot, Context} from 'grammy'
import type {Service, ConversationTurn} from '../types'
import type {LavaClawSettings} from '../settings'
import type {GeminiService} from './gemini'
import type {AgentRunner} from './agent-runner'
import type {MemoryService} from './memory'

type SaveSettingsFn = () => Promise<void>

export class TelegramService implements Service {
	readonly id = 'telegram'
	private settings: LavaClawSettings
	private gemini: GeminiService
	private agentRunner: AgentRunner
	private memory: MemoryService
	private saveSettings: SaveSettingsFn
	private bot: Bot | null = null
	private session: import('@google/generative-ai').ChatSession | null = null

	constructor(
		settings: LavaClawSettings,
		gemini: GeminiService,
		agentRunner: AgentRunner,
		memory: MemoryService,
		saveSettings: SaveSettingsFn
	) {
		this.settings = settings
		this.gemini = gemini
		this.agentRunner = agentRunner
		this.memory = memory
		this.saveSettings = saveSettings
	}

	async init(): Promise<void> {
		const {enabled, botToken} = this.settings.telegram
		if (!enabled || !botToken) return

		try {
			this.bot = new Bot(botToken)

			const systemPrompt = await this.memory.getContext()
			this.session = this.gemini.createSession(systemPrompt)

			this.bot.on('message:text', (ctx) => this.onMessage(ctx))
			void this.bot.start({
				onStart: () => console.debug('Lava Claw: Telegram bot started'),
			})
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw: Failed to start Telegram bot: ${msg}`)
			this.bot = null
		}
	}

	async destroy(): Promise<void> {
		if (this.bot) {
			await this.bot.stop()
			this.bot = null
		}
		this.session = null
	}

	private isAuthorized(userId: string): boolean {
		const {ownerUserId, allowedUserIds} = this.settings.telegram
		if (ownerUserId && userId === ownerUserId) return true
		if (allowedUserIds.includes(userId)) return true
		return false
	}

	private async onMessage(ctx: Context): Promise<void> {
		const userId = String(ctx.from?.id ?? '')
		const text = ctx.message?.text ?? ''
		if (!text) return

		// First-time setup: if no owner is configured, tell the user their ID
		if (!this.settings.telegram.ownerUserId) {
			await ctx.reply(
				`Lava Claw is not configured yet.\n\nYour Telegram user ID is: \`${userId}\`\n\nPaste it into Obsidian → Settings → Lava Claw → Owner Telegram user ID.`,
				{parse_mode: 'Markdown'}
			)
			return
		}

		if (!this.isAuthorized(userId)) {
			await ctx.reply('Unauthorized.')
			return
		}

		// Auto-populate ownerChatId on first authorized message
		if (!this.settings.telegram.ownerChatId) {
			this.settings.telegram.ownerChatId = String(ctx.chat?.id ?? '')
			await this.saveSettings()
		}

		// Lazily create session if not already initialized
		if (!this.session) {
			const systemPrompt = await this.memory.getContext()
			this.session = this.gemini.createSession(systemPrompt)
		}

		const userTurn: ConversationTurn = {role: 'user', content: text, timestamp: Date.now()}
		await this.memory.appendToDaily(userTurn)

		try {
			const response = await this.agentRunner.run(this.session, text)
			const assistantTurn: ConversationTurn = {role: 'assistant', content: response, timestamp: Date.now()}
			await this.memory.appendToDaily(assistantTurn)
			if (response) await ctx.reply(response, {parse_mode: 'Markdown'})
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			await ctx.reply(`Error: ${msg}`)
		}
	}

	// Called from settings UI "Detect my ID" button
	// Note: simpler path is to just message the bot — it will reply with your user ID
	// if ownerUserId is not yet configured (see onMessage first-time setup block).
	startDetectMode(onDetected: (userId: string) => void): void {
		if (!this.bot) return
		this.bot.on('message:text', (ctx: Context) => {
			const userId = String(ctx.from?.id ?? '')
			if (userId) onDetected(userId)
		})
	}
}
