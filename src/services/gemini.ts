import {Notice, requestUrl} from 'obsidian'
import {spawn} from 'child_process'
import type {LLMProvider, Prompt} from '../types'
import type {LavaClawSettings} from '../settings'

interface GeminiContent {
	role: string
	parts: Array<{text: string}>
}

interface GeminiRequest {
	system_instruction?: {parts: Array<{text: string}>}
	contents: GeminiContent[]
	generationConfig?: {maxOutputTokens?: number}
}

interface GeminiCandidate {
	content?: {parts?: Array<{text?: string}>}
}

export class GeminiService implements LLMProvider {
	readonly id = 'gemini'
	private settings: LavaClawSettings

	constructor(settings: LavaClawSettings) {
		this.settings = settings
	}

	async init(): Promise<void> {
		// no-op — connection validated lazily on first call
	}

	async destroy(): Promise<void> {
		// no-op
	}

	async *complete(prompt: Prompt): AsyncGenerator<string> {
		if (this.settings.llm.authMethod === 'cli') {
			yield* this.completeViaCLI(prompt)
		} else {
			yield* this.completeViaAPI(prompt)
		}
	}

	private buildSystemPrompt(prompt: Prompt): string {
		const parts = [prompt.system]
		if (prompt.memory) parts.push(prompt.memory)
		if (prompt.vaultContext) parts.push(`## Vault context\n${prompt.vaultContext}`)
		if (prompt.skills.length > 0) parts.push(`## Skills\n${prompt.skills.join('\n\n')}`)
		return parts.join('\n\n')
	}

	private buildContents(prompt: Prompt): GeminiContent[] {
		const contents: GeminiContent[] = prompt.history.map(turn => ({
			role: turn.role === 'user' ? 'user' : 'model',
			parts: [{text: turn.content}],
		}))
		contents.push({role: 'user', parts: [{text: prompt.message}]})
		return contents
	}

	private async *completeViaAPI(prompt: Prompt): AsyncGenerator<string> {
		const {apiKey, model} = this.settings.llm
		if (!apiKey) {
			new Notice('Gemini API key is not configured. Add it in Lava Claw settings.')
			return
		}

		const body: GeminiRequest = {
			system_instruction: {
				parts: [{text: this.buildSystemPrompt(prompt)}],
			},
			contents: this.buildContents(prompt),
		}

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

		try {
			const response = await requestUrl({
				url,
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(body),
				throw: false,
			})

			if (response.status < 200 || response.status >= 300) {
				const preview = response.text.slice(0, 100)
				new Notice(`Lava Claw: Gemini API error ${response.status}: ${preview}`)
				return
			}

			const parsed = response.json as {candidates?: GeminiCandidate[]}
			const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
			if (text) yield text
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw: Gemini request failed: ${msg}`)
		}
	}

	private async *completeViaCLI(prompt: Prompt): AsyncGenerator<string> {
		const systemPrompt = this.buildSystemPrompt(prompt)
		const userMessage = prompt.message
		const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}\nAssistant:`

		async function* runCLI(model: string, input: string): AsyncGenerator<string> {
			const proc = spawn('gemini', ['--model', model], {
				stdio: ['pipe', 'pipe', 'pipe'],
			})

			let resolveError: (err: Error | null) => void
			const errorPromise = new Promise<Error | null>(res => { resolveError = res })

			proc.on('error', (err: Error) => {
				resolveError(err)
			})
			proc.on('close', () => {
				resolveError(null)
			})

			proc.stdin.write(input)
			proc.stdin.end()

			for await (const chunk of proc.stdout) {
				yield String(chunk)
			}

			const err = await errorPromise
			if (err) throw err
		}

		try {
			yield* runCLI(this.settings.llm.model, fullPrompt)
		} catch (e) {
			const err = e as Error & {code?: string}
			if (err.code === 'ENOENT') {
				new Notice('Lava Claw: Gemini CLI not found. Install it or switch to API key auth.')
			} else {
				new Notice(`Lava Claw: Gemini CLI error: ${err.message}`)
			}
		}
	}
}
