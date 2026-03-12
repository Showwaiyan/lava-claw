import {FunctionCallingMode, GoogleGenerativeAI} from '@google/generative-ai'
import type {ChatSession, FunctionDeclaration, Tool as GeminiTool} from '@google/generative-ai'
import type {Service} from '../types'
import type {LavaClawSettings} from '../settings'

export class GeminiService implements Service {
	readonly id = 'gemini'
	private settings: LavaClawSettings
	private toolDeclarations: FunctionDeclaration[] = []

	constructor(settings: LavaClawSettings) {
		this.settings = settings
	}

	async init(): Promise<void> {
		// no-op — validated lazily on first createSession call
	}

	async destroy(): Promise<void> {
		// no-op
	}

	setToolDeclarations(defs: FunctionDeclaration[]): void {
		this.toolDeclarations = defs
	}

	createSession(systemPrompt?: string): ChatSession {
		const {apiKey, model} = this.settings.llm
		if (!apiKey) throw new Error('Gemini API key is not configured. Add it in Lava Claw settings.')

		const genAI = new GoogleGenerativeAI(apiKey)
		const tools: GeminiTool[] = this.toolDeclarations.length > 0
			? [{functionDeclarations: this.toolDeclarations}]
			: []

		const generativeModel = genAI.getGenerativeModel({
			model,
			systemInstruction: systemPrompt,
			tools,
			toolConfig: this.toolDeclarations.length > 0
				? {functionCallingConfig: {mode: FunctionCallingMode.AUTO}}
				: undefined,
		})

		return generativeModel.startChat()
	}
}
