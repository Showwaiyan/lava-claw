import {SchemaType} from '@google/generative-ai'
import type {Tool, ToolContext} from './index'

export const readSoulTool: Tool = {
	definition: {
		name: 'read_soul',
		description: 'Read the SOUL.md file from the workspace. Contains the AI identity and personality.',
		parameters: {type: SchemaType.OBJECT, properties: {}, required: []},
	},
	async execute(_args, ctx: ToolContext) {
		try {
			return await ctx.memory.readWorkspaceFile('SOUL.md')
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const writeSoulTool: Tool = {
	definition: {
		name: 'write_soul',
		description: 'Overwrite SOUL.md with new content. Use to update the AI identity and personality.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				content: {type: SchemaType.STRING, description: 'Full new content for SOUL.md'},
			},
			required: ['content'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const content = args['content']
		if (typeof content !== 'string') return 'Error: content must be a string'
		try {
			await ctx.memory.writeWorkspaceFile('SOUL.md', content)
			return 'SOUL.md updated.'
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const readMemoryTool: Tool = {
	definition: {
		name: 'read_memory',
		description: 'Read MEMORY.md from the workspace. Contains long-term memory about the user.',
		parameters: {type: SchemaType.OBJECT, properties: {}, required: []},
	},
	async execute(_args, ctx: ToolContext) {
		try {
			return await ctx.memory.readWorkspaceFile('memory.md')
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const writeMemoryTool: Tool = {
	definition: {
		name: 'write_memory',
		description: 'Overwrite MEMORY.md with new content. Use to update long-term memory about the user.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				content: {type: SchemaType.STRING, description: 'Full new content for memory.md'},
			},
			required: ['content'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const content = args['content']
		if (typeof content !== 'string') return 'Error: content must be a string'
		try {
			await ctx.memory.updateMemory(content)
			return 'Memory updated.'
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const appendDailyLogTool: Tool = {
	definition: {
		name: 'append_daily_log',
		description: "Append an entry to today's daily log note. Path is resolved automatically as Daily/YYYY-MM-DD.md.",
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				content: {type: SchemaType.STRING, description: "Content to append to today's log"},
			},
			required: ['content'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const content = args['content']
		if (typeof content !== 'string') return 'Error: content must be a string'
		try {
			await ctx.memory.appendToDaily({
				role: 'assistant',
				content,
				timestamp: Date.now(),
			})
			return 'Appended to daily log.'
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export function registerMemoryTools(registry: import('./index').ToolRegistry): void {
	registry.register(readSoulTool)
	registry.register(writeSoulTool)
	registry.register(readMemoryTool)
	registry.register(writeMemoryTool)
	registry.register(appendDailyLogTool)
}
