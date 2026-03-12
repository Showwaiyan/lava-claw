import type {ChatSession, Part} from '@google/generative-ai'
import type {ToolRegistry, ToolContext} from '../tools/index'

const MAX_ITERATIONS = 10

export class AgentRunner {
	private registry: ToolRegistry
	private ctx: ToolContext

	constructor(registry: ToolRegistry, ctx: ToolContext) {
		this.registry = registry
		this.ctx = ctx
	}

	async run(
		session: ChatSession,
		message: string,
		onToolStart?: (name: string) => void,
		onToolDone?: (name: string) => void,
		onToolError?: (name: string, err: string) => void,
	): Promise<string> {
		let parts: Part[] = [{text: message}]
		let iterations = 0

		while (true) {
			if (iterations >= MAX_ITERATIONS) {
				throw new Error(`Agent loop exceeded ${MAX_ITERATIONS} iterations without a final response.`)
			}
			iterations++

			const result = await session.sendMessage(parts)
			const response = result.response

			const functionCalls = response.functionCalls()
			if (!functionCalls || functionCalls.length === 0) {
				return response.text()
			}

			// Execute all tool calls and collect responses
			const toolResponseParts: Part[] = []
			for (const call of functionCalls) {
				onToolStart?.(call.name)
				let output: string
				try {
					output = await this.registry.dispatch(call.name, call.args as Record<string, unknown>, this.ctx)
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
}
