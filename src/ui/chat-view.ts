import {App, ItemView, MarkdownRenderer, Notice, WorkspaceLeaf} from 'obsidian'
import type {MessageSource, ConversationTurn} from '../types'
import type {Service} from '../types'

export const CHAT_VIEW_TYPE = 'lava-claw-chat'

export class ChatView extends ItemView implements Service, MessageSource {
	readonly id = 'chat-view'
	private core: import('../core').PluginCore
	private messagesEl!: HTMLElement
	private inputEl!: HTMLTextAreaElement
	private sendBtn!: HTMLButtonElement
	private isLoading = false
	// Tracks the last streaming bubble element for incremental updates
	private streamingEl: HTMLElement | null = null

	constructor(leaf: WorkspaceLeaf, core: import('../core').PluginCore) {
		super(leaf)
		this.core = core
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE
	}

	getDisplayText(): string {
		return 'Lava Claw'
	}

	getIcon(): string {
		return 'bot'
	}

	async onOpen(): Promise<void> {
		this.buildUI()
		// Restore existing session from core
		for (const turn of this.core.getHistory()) {
			this.appendTurnToUI(turn)
		}
	}

	async onClose(): Promise<void> {
		// Session lives in PluginCore — nothing to destroy here
	}

	// Service interface
	async init(): Promise<void> {
		// no-op — view is registered by PluginCore via registerView
	}

	async destroy(): Promise<void> {
		// no-op — Obsidian handles leaf cleanup
	}

	// MessageSource interface
	async reply(turn: ConversationTurn): Promise<void> {
		if (turn.role !== 'assistant') return

		if (this.streamingEl) {
			// Update in-place during streaming
			this.streamingEl.empty()
			await MarkdownRenderer.render(
				this.app,
				turn.content,
				this.streamingEl,
				'',
				this
			)
			this.scrollToBottom()
			return
		}

		// First chunk — create the streaming bubble
		this.streamingEl = this.messagesEl.createDiv({cls: 'lava-claw-message lava-claw-assistant'})
		await MarkdownRenderer.render(
			this.app,
			turn.content || '▌',
			this.streamingEl,
			'',
			this
		)
		this.scrollToBottom()
	}

	finalizeStreaming(): void {
		this.streamingEl = null
		this.setLoading(false)
	}

	private buildUI(): void {
		const {contentEl} = this
		contentEl.empty()
		contentEl.addClass('lava-claw-container')

		// Header
		const headerEl = contentEl.createDiv({cls: 'lava-claw-header'})
		headerEl.createSpan({text: 'Lava Claw', cls: 'lava-claw-title'})
		const clearBtn = headerEl.createEl('button', {text: 'Clear', cls: 'lava-claw-clear-btn'})
		clearBtn.addEventListener('click', () => this.clearSession())

		// Messages area
		this.messagesEl = contentEl.createDiv({cls: 'lava-claw-messages'})

		// Input bar
		const inputBarEl = contentEl.createDiv({cls: 'lava-claw-input-bar'})
		this.inputEl = inputBarEl.createEl('textarea', {
			cls: 'lava-claw-input',
			attr: {placeholder: 'Message Lava Claw...', rows: '1'},
		})
		this.sendBtn = inputBarEl.createEl('button', {text: '→', cls: 'lava-claw-send-btn'})

		this.sendBtn.addEventListener('click', () => this.sendMessage())
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				this.sendMessage()
			}
		})
	}

	private async sendMessage(): Promise<void> {
		const text = this.inputEl.value.trim()
		if (!text || this.isLoading) return

		this.inputEl.value = ''
		this.setLoading(true)
		this.streamingEl = null

		// Render user turn immediately
		const userTurn: ConversationTurn = {
			role: 'user',
			content: text,
			timestamp: Date.now(),
		}
		this.appendTurnToUI(userTurn)

		try {
			await this.core.handleMessage(text, this)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw error: ${msg}`)
		} finally {
			this.finalizeStreaming()
		}
	}

	private appendTurnToUI(turn: ConversationTurn): void {
		const cls = turn.role === 'user' ? 'lava-claw-user' : 'lava-claw-assistant'
		const el = this.messagesEl.createDiv({cls: `lava-claw-message ${cls}`})
		if (turn.role === 'assistant') {
			MarkdownRenderer.render(this.app, turn.content, el, '', this)
		} else {
			el.setText(turn.content)
		}
		this.scrollToBottom()
	}

	private clearSession(): void {
		this.core.clearHistory()
		this.messagesEl.empty()
		this.streamingEl = null
	}

	private setLoading(loading: boolean): void {
		this.isLoading = loading
		this.inputEl.disabled = loading
		this.sendBtn.disabled = loading
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight
	}
}
