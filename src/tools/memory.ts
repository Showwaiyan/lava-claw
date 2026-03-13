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

export const readWorkspaceFileTool: Tool = {
	definition: {
		name: 'read_workspace_file',
		description: 'Read a file from the workspace folder (.lava-claw/). Use for IDENTITY.md, USER.md, etc.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				filename: {type: SchemaType.STRING, description: 'Filename only (e.g., "IDENTITY.md", "USER.md")'},
			},
			required: ['filename'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const filename = args['filename']
		if (typeof filename !== 'string') return 'Error: filename must be a string'
		try {
			return await ctx.memory.readWorkspaceFile(filename)
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const writeWorkspaceFileTool: Tool = {
	definition: {
		name: 'write_workspace_file',
		description: 'Write to a file in the workspace folder (.lava-claw/). Use for IDENTITY.md, USER.md, etc.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				filename: {type: SchemaType.STRING, description: 'Filename only (e.g., "IDENTITY.md", "USER.md")'},
				content: {type: SchemaType.STRING, description: 'Full content to write'},
			},
			required: ['filename', 'content'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const filename = args['filename']
		const content = args['content']
		if (typeof filename !== 'string') return 'Error: filename must be a string'
		if (typeof content !== 'string') return 'Error: content must be a string'
		try {
			await ctx.memory.writeWorkspaceFile(filename, content)
			return `${filename} updated.`
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

export const readDailyLogTool: Tool = {
	definition: {
		name: 'read_daily_log',
		description: "Read a past daily log from memory/. Use when you need to recall past conversations. Format: YYYY-MM-DD.",
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				date: {type: SchemaType.STRING, description: 'Date in YYYY-MM-DD format (e.g., "2026-03-13")'},
			},
			required: ['date'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const date = args['date']
		if (typeof date !== 'string') return 'Error: date must be a string'
		try {
			const content = await ctx.memory.readDailyLog(date)
			return `## ${date}\n${content}`
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
	registry.register(readDailyLogTool)
	registry.register(readWorkspaceFileTool)
	registry.register(writeWorkspaceFileTool)
}
