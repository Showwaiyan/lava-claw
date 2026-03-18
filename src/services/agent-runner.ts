import type {LLMSession, MessagePart} from '../types'
import type {ToolRegistry, ToolContext} from '../tools/index'

const MAX_ITERATIONS = 10

const MEMORY_EXTRACTION_PROMPT = `Review the conversation above. Was anything important enough to remember long-term (preferences, personal info, key decisions, important facts)?

If YES: Use the write_memory tool to update memory.md with the important information. Keep it concise - only what truly matters for future conversations.

If NO: Just acknowledge briefly (e.g., "No important information to save"). Do NOT use write_memory if there's nothing important.`

export class AgentRunner {
	private registry: ToolRegistry
	private ctx: ToolContext

	constructor(registry: ToolRegistry, ctx: ToolContext) {
		this.registry = registry
		this.ctx = ctx
	}

	async run(
		session: LLMSession,
		message: string,
		onToolStart?: (name: string) => void,
		onToolDone?: (name: string) => void,
		onToolError?: (name: string, err: string) => void,
	): Promise<string> {
		let parts: MessagePart[] = [{text: message}]
		let iterations = 0

		while (true) {
			if (iterations >= MAX_ITERATIONS) {
				throw new Error(`Agent loop exceeded ${MAX_ITERATIONS} iterations without a final response.`)
			}
			iterations++

		const result = await session.sendMessage(parts)
			const functionCalls = result.functionCalls()
			if (functionCalls.length === 0) {
				return result.text()
			}

			// Execute all tool calls and collect responses
			const toolResponseParts: MessagePart[] = []
			for (const call of functionCalls) {
				onToolStart?.(call.name)
				let output: string
				try {
					output = await this.registry.dispatch(call.name, call.args, this.ctx)
					if (output.startsWith('Error:')) {
						onToolError?.(call.name, output)
					} else {
						onToolDone?.(call.name)
					}
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e)
					output = `Error: ${msg}`
					onToolError?.(call.name, output)
				}

				toolResponseParts.push({
					functionResponse: {
						name: call.name,
						response: {output},
					},
				})
			}

			parts = toolResponseParts
		}
	}

	async extractMemory(session: LLMSession): Promise<void> {
		await this.run(session, MEMORY_EXTRACTION_PROMPT)
	}
}
