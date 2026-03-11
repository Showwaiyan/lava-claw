import {Notice} from 'obsidian'
import {Bot, Context} from 'grammy'
import type {Service, MessageSource, ConversationTurn} from '../types'
import type {LavaClawSettings} from '../settings'

type SaveSettingsFn = () => Promise<void>

export class TelegramService implements Service, MessageSource {
	readonly id = 'telegram'
	private settings: LavaClawSettings
	private saveSettings: SaveSettingsFn
	private bot: Bot | null = null
	private handleMessageFn: (text: string, source: MessageSource) => Promise<void>

	constructor(
		settings: LavaClawSettings,
		handleMessage: (text: string, source: MessageSource) => Promise<void>,
		saveSettings: SaveSettingsFn
	) {
		this.settings = settings
		this.handleMessageFn = handleMessage
		this.saveSettings = saveSettings
	}

	async init(): Promise<void> {
		const {enabled, botToken} = this.settings.telegram
		if (!enabled || !botToken) return

		try {
			this.bot = new Bot(botToken)
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
	}

	// MessageSource interface — no-op; used only as placeholder
	// Actual replies are sent directly via ctx.reply() in onMessage
	async reply(_turn: ConversationTurn): Promise<void> {
		// no-op
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

		// Auto-populate ownerChatId on first authorized message
		if (this.isAuthorized(userId) && !this.settings.telegram.ownerChatId) {
			this.settings.telegram.ownerChatId = String(ctx.chat?.id ?? '')
			await this.saveSettings()
		}

		if (!this.isAuthorized(userId)) {
			await ctx.reply('Unauthorized.')
			return
		}

		// Collect full streamed response
		let fullResponse = ''
		const collectingSource: MessageSource = {
			id: 'telegram-collector',
			async reply(turn: ConversationTurn) {
				fullResponse = turn.content
			},
		}

		try {
			await this.handleMessageFn(text, collectingSource)
			if (fullResponse) {
				await ctx.reply(fullResponse, {parse_mode: 'Markdown'})
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			await ctx.reply(`Error: ${msg}`)
		}
	}

	// Called from settings UI "Detect my ID" button
	startDetectMode(onDetected: (userId: string) => void): void {
		if (!this.bot) return
		const handler = (ctx: Context) => {
			const userId = String(ctx.from?.id ?? '')
			if (userId) onDetected(userId)
		}
		this.bot.on('message:text', handler)
	}
}
