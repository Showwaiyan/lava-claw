import type {FunctionDeclaration} from '@google/generative-ai'
import type {App} from 'obsidian'
import type {VaultService} from '../services/vault'
import type {MemoryService} from '../services/memory'
import type {LavaClawSettings} from '../settings'

export interface ToolContext {
	app: App
	vault: VaultService
	memory: MemoryService
	settings: LavaClawSettings
}

export interface Tool {
	definition: FunctionDeclaration
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

export class ToolRegistry {
	private tools = new Map<string, Tool>()

	register(tool: Tool): void {
		this.tools.set(tool.definition.name, tool)
	}

	getDefinitions(): FunctionDeclaration[] {
		return Array.from(this.tools.values()).map(t => t.definition)
	}

	async dispatch(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
		const tool = this.tools.get(name)
		if (!tool) return `Unknown tool: ${name}`
		try {
			return await tool.execute(args, ctx)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return `Error: ${msg}`
		}
	}
}
