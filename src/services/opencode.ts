import {requestUrl} from 'obsidian'
import type {FunctionDeclaration} from '@google/generative-ai'
import type {Service, LLMSession, MessagePart, LLMResponse} from '../types'
import type {LavaClawSettings} from '../settings'

interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'function'
	content: string
	name?: string
	function_call?: {
		name: string
		arguments: string
	}
}

interface OpenAIFunctionCall {
	name: string
	arguments: string
}

interface OpenAIChoice {
	message: {
		role: string
		content: string | null
		function_call?: OpenAIFunctionCall
	}
	finish_reason: string
}

interface OpenAIResponse {
	choices: OpenAIChoice[]
}

class OpenCodeSession implements LLMSession {
	private apiKey: string
	private model: string
	private messages: OpenAIMessage[] = []

	constructor(apiKey: string, model: string, systemPrompt?: string) {
		this.apiKey = apiKey
		this.model = model
		if (systemPrompt) {
			this.messages.push({role: 'system', content: systemPrompt})
		}
	}

	async sendMessage(parts: MessagePart[]): Promise<LLMResponse> {
		for (const part of parts) {
			if ('text' in part && part.text) {
				this.messages.push({role: 'user', content: part.text})
			} else if ('functionResponse' in part && part.functionResponse) {
				this.messages.push({
					role: 'function',
					name: part.functionResponse.name,
					content: part.functionResponse.response.output,
				})
			}
		}

		const body: Record<string, unknown> = {
			model: this.model,
			messages: this.messages,
			stream: false,
		}

		const response = await requestUrl({
			url: 'https://opencode.ai/zen/v1/chat/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
		})

		if (response.status !== 200) {
			throw new Error(`OpenCode API error: ${response.status} - ${response.text}`)
		}

		const data = JSON.parse(response.text) as OpenAIResponse
		const choice = data.choices[0]
		if (!choice) {
			throw new Error('No response from OpenCode API')
		}

		const assistantMessage = choice.message

		if (assistantMessage.function_call) {
			const fnCall = assistantMessage.function_call
			const args = JSON.parse(fnCall.arguments) as Record<string, unknown>
			this.messages.push({
				role: 'assistant',
				content: '',
				function_call: {
					name: fnCall.name,
					arguments: fnCall.arguments,
				},
			})

			return {
				text: () => '',
				functionCalls: () => [{name: fnCall.name, args}],
			}
		}

		const text = assistantMessage.content ?? ''
		this.messages.push({role: 'assistant', content: text})

		return {
			text: () => text,
			functionCalls: () => [],
		}
	}
}

export class OpenCodeService implements Service {
	readonly id = 'opencode'
	private settings: LavaClawSettings
	private toolDeclarations: {name: string; description: string; parameters: Record<string, unknown>}[] = []

	constructor(settings: LavaClawSettings) {
		this.settings = settings
	}

	async init(): Promise<void> {
		// no-op
	}

	async destroy(): Promise<void> {
		// no-op
	}

	setToolDeclarations(defs: FunctionDeclaration[]): void {
		this.toolDeclarations = defs
			.filter(d => d.name && d.parameters)
			.map(d => ({
				name: d.name ?? '',
				description: d.description ?? '',
				parameters: d.parameters as unknown as Record<string, unknown>,
			}))
	}

	createSession(systemPrompt?: string): LLMSession {
		const {apiKey, model} = this.settings.llm
		if (!apiKey) {
			throw new Error('OpenCode API key is not configured. Add it in Lava Claw settings.')
		}

		return new OpenCodeSession(apiKey, model, systemPrompt)
	}

	async listModels(): Promise<string[]> {
		const {apiKey} = this.settings.llm
		if (!apiKey) return []

		try {
			const response = await requestUrl({
				url: 'https://opencode.ai/zen/v1/models',
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			})

			if (response.status !== 200) {
				throw new Error(`Failed to fetch models: ${response.status}`)
			}

			const data = JSON.parse(response.text) as {models: {id: string}[]}
			return data.models.map(m => m.id).sort()
		} catch {
			return []
		}
	}
}
