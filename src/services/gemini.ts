import {GoogleGenerativeAI, FunctionCallingMode} from '@google/generative-ai'
import type {ChatSession, FunctionDeclaration, Tool as GeminiTool} from '@google/generative-ai'
import {Notice} from 'obsidian'
import {execFile} from 'child_process'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type {LLMProvider, Prompt} from '../types'
import type {LavaClawSettings} from '../settings'

export class GeminiService implements LLMProvider {
	readonly id = 'gemini'
	private settings: LavaClawSettings
	private chatSession: ChatSession | null = null
	private toolDefs: FunctionDeclaration[] = []

	constructor(settings: LavaClawSettings) {
		this.settings = settings
	}

	async init(): Promise<void> {
		// no-op — connection validated lazily on first call
	}

	async destroy(): Promise<void> {
		// no-op
	}

	setTools(defs: FunctionDeclaration[]): void {
		this.toolDefs = defs
		this.chatSession = null   // force re-creation with new tools
	}

	resetSession(): void {
		this.chatSession = null
	}

	async *complete(
		prompt: Prompt,
		onToolStart?: (name: string) => void,
		onToolDone?: (name: string) => void,
		onToolError?: (name: string, err: string) => void,
		toolCtx?: import('../tools/index').ToolContext,
	): AsyncGenerator<string> {
		if (this.settings.llm.authMethod === 'cli') {
			yield* this.completeViaCLI(prompt)
		} else {
			yield* this.completeViaAPI(prompt, onToolStart, onToolDone, onToolError, toolCtx)
		}
	}

	private buildSystemPrompt(prompt: Prompt): string {
		const parts = [prompt.system]
		if (prompt.memory) parts.push(prompt.memory)
		if (prompt.vaultContext) parts.push(`## Vault context\n${prompt.vaultContext}`)
		if (prompt.skills.length > 0) parts.push(`## Skills\n${prompt.skills.join('\n\n')}`)
		return parts.join('\n\n')
	}

	private getOrCreateSession(systemPrompt: string): ChatSession {
		if (this.chatSession) return this.chatSession

		const genAI = new GoogleGenerativeAI(this.settings.llm.apiKey)
		const tools: GeminiTool[] = this.toolDefs.length > 0
			? [{functionDeclarations: this.toolDefs}]
			: []

		const model = genAI.getGenerativeModel({
			model: this.settings.llm.model,
			systemInstruction: systemPrompt,
			tools,
			toolConfig: this.toolDefs.length > 0
				? {functionCallingConfig: {mode: FunctionCallingMode.AUTO}}
				: undefined,
		})

		this.chatSession = model.startChat()
		return this.chatSession
	}

	private async *completeViaAPI(
		prompt: Prompt,
		onToolStart?: (name: string) => void,
		onToolDone?: (name: string) => void,
		onToolError?: (name: string, err: string) => void,
		toolCtx?: import('../tools/index').ToolContext,
	): AsyncGenerator<string> {
		const {apiKey} = this.settings.llm
		if (!apiKey) {
			new Notice('Gemini API key is not configured. Add it in Lava Claw settings.')
			return
		}

		const systemPrompt = this.buildSystemPrompt(prompt)
		const session = this.getOrCreateSession(systemPrompt)

		// The ChatSession owns history — we only send the new user message each turn
		const userMessage = prompt.message

		try {
			// Agent loop: keep sending tool responses until the model emits text
			let parts: import('@google/generative-ai').Part[] = [{text: userMessage}]

			while (true) {
				const result = await session.sendMessageStream(parts)
				const response = await result.response

				const functionCalls = response.functionCalls()
				if (functionCalls && functionCalls.length > 0 && toolCtx) {
					// Execute all tool calls, collect responses
					const toolResponseParts: import('@google/generative-ai').Part[] = []

					for (const call of functionCalls) {
						onToolStart?.(call.name)
						const args = call.args as Record<string, unknown>
						const registry = (toolCtx as unknown as {_registry?: import('../tools/index').ToolRegistry})._registry
						let toolResult: string
						if (registry) {
							toolResult = await registry.dispatch(call.name, args, toolCtx)
						} else {
							toolResult = 'Error: no tool registry available'
						}

						if (toolResult.startsWith('Error:')) {
							onToolError?.(call.name, toolResult)
						} else {
							onToolDone?.(call.name)
						}

						toolResponseParts.push({
							functionResponse: {
								name: call.name,
								response: {output: toolResult},
							},
						})
					}

					// Feed tool results back into the loop
					parts = toolResponseParts
					continue
				}

				// No tool calls — stream text to caller
				for await (const chunk of result.stream) {
					const text = chunk.text()
					if (text) yield text
				}
				break
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw: Gemini request failed: ${msg}`)
		}
	}

	private async *completeViaCLI(prompt: Prompt): AsyncGenerator<string> {
		const systemPrompt = this.buildSystemPrompt(prompt)
		const userMessage = prompt.message
		const fullPrompt = systemPrompt
			? `${systemPrompt}\n\nUser: ${userMessage}`
			: userMessage

		const cliPath = this.settings.llm.cliPath || 'gemini'

		try {
			const output = await this.runGeminiCLI(cliPath, fullPrompt)
			if (output) yield output
		} catch (e) {
			const err = e as Error & {code?: string}
			if (err.code === 'ENOENT') {
				new Notice(`Lava Claw: Gemini CLI not found at "${cliPath}". Set the correct path in settings or switch to API key auth.`)
			} else {
				new Notice(`Lava Claw: Gemini CLI error: ${err.message}`)
			}
		}
	}

	// findBinary walks the augmented PATH to locate a binary cross-platform.
	// It compensates for Obsidian's stripped GUI PATH by prepending common install
	// prefixes. On Windows it also tries each PATHEXT extension.
	private findBinary(name: string): string | null {
		// If name contains a path separator the user gave us an explicit path — use it directly.
		if (name.includes('/') || name.includes('\\')) {
			try {
				fs.accessSync(name, fs.constants.X_OK)
				return name
			} catch {
				return null
			}
		}

		// Build augmented PATH: prepend common install prefixes that GUI apps often miss.
		const home = os.homedir()
		const extraPaths = process.platform === 'win32'
			? [
				path.join(home, 'AppData', 'Roaming', 'npm'),            // npm -g on Windows
				path.join(home, 'AppData', 'Local', 'Programs', 'nodejs'), // nvm-windows
				'C:\\Program Files\\nodejs',
				'C:\\ProgramData\\chocolatey\\bin',                        // Chocolatey
			]
			: [
				path.join(home, '.local', 'bin'),                          // pip install --user, pipx
				path.join(home, '.npm-global', 'bin'),                     // npm -g custom prefix
				path.join(home, '.yarn', 'bin'),                           // yarn global
				path.join(home, '.bun', 'bin'),                            // bun
				'/opt/homebrew/bin',                                        // Homebrew on Apple Silicon
				'/usr/local/bin',                                           // Homebrew on Intel / npm -g default
			]

		const rawPath = process.env.PATH ?? ''
		const augmented = [...extraPaths, ...rawPath.split(path.delimiter)].filter(Boolean)

		// On Windows, also try each PATHEXT extension (e.g. .EXE, .CMD).
		// On Unix, use empty string so we just try the bare name.
		const extensions = process.platform === 'win32'
			? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
				.split(';')
				.map(e => e.trim())
				.filter(Boolean)
			: ['']

		for (const dir of augmented) {
			for (const ext of extensions) {
				const candidate = path.join(dir, name + ext)
				try {
					const stat = fs.statSync(candidate)
					if (!stat.isFile()) continue
					// On Windows, file existence is sufficient (no execute bit concept).
					// On Unix, verify the execute bit is set.
					if (process.platform !== 'win32') {
						fs.accessSync(candidate, fs.constants.X_OK)
					}
					return candidate
				} catch {
					// not found or not executable — try next
				}
			}
		}

		return null
	}

	// runGeminiCLI resolves the binary via PATH walk then runs it with execFile.
	// If cliPath contains a path separator it is used directly (explicit user override).
	// Otherwise the name is resolved by walking the augmented PATH.
	runGeminiCLI(cliPath: string, input: string): Promise<string> {
		return new Promise((resolve, reject) => {
		const resolvedPath = this.findBinary(cliPath)
		if (!resolvedPath) {
			const err = Object.assign(
				new Error(
					`Gemini CLI "${cliPath}" not found in PATH. ` +
					`Install it (e.g. npm install -g @google/gemini-cli) ` +
					`or set the full path in Lava Claw settings.`
				),
				{code: 'ENOENT'}
			)
			reject(err)
			return
		}

			execFile(resolvedPath, ['--prompt', input], {
				timeout: 120_000,
				maxBuffer: 10 * 1024 * 1024,
				env: {
					...process.env,
					HOME: process.env.HOME ?? os.homedir(),
				},
			}, (error, stdout, stderr) => {
				if (error) {
					const detail = stderr?.trim() ? `\nStderr: ${stderr.trim()}` : ''
					error.message = `${error.message}${detail}`
					// error from execFile is always an Error instance
					// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
					reject(error)
					return
				}
				resolve(stdout)
			})
		})
	}
}
