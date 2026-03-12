import {Notice, requestUrl} from 'obsidian'
import {execFile} from 'child_process'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
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
