import {SchemaType} from '@google/generative-ai'
import type {Tool, ToolContext} from './index'

export const updateMemoryTool: Tool = {
	definition: {
		name: 'update_memory',
		description: 'Overwrite the entire long-term memory file (memory.md) with new content. Use this to record facts about the user or important context to remember across sessions.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				content: {type: SchemaType.STRING, description: 'Full new content for memory.md'},
			},
			required: ['content'],
		},
	},
	async execute(args, _ctx: ToolContext) {
		const content = args['content']
		if (typeof content !== 'string') return 'Error: content must be a string'
		await _ctx.memory.updateMemory(content)
		return 'Memory updated.'
	},
}

export function registerMemoryTools(registry: import('./index').ToolRegistry): void {
	registry.register(updateMemoryTool)
}
