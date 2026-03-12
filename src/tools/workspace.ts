import {SchemaType} from '@google/generative-ai'
import type {Tool} from './index'

const ALLOWED_FILES = new Set(['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'memory.md'])

function validateFilename(filename: unknown): string | null {
	if (typeof filename !== 'string') return 'Error: filename must be a string'
	// Reject any path traversal
	if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
		return 'Error: path traversal not allowed'
	}
	if (!ALLOWED_FILES.has(filename)) {
		return `Error: "${filename}" is not an allowed workspace file. Allowed: ${[...ALLOWED_FILES].join(', ')}`
	}
	return null
}

export const readWorkspaceFileTool: Tool = {
	definition: {
		name: 'read_workspace_file',
		description: 'Read a file from the .lava-claw workspace folder. Allowed files: SOUL.md, IDENTITY.md, USER.md, TOOLS.md, memory.md.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				filename: {type: SchemaType.STRING, description: 'Filename to read, e.g. "SOUL.md"'},
			},
			required: ['filename'],
		},
	},
	async execute(args, ctx) {
		const err = validateFilename(args['filename'])
		if (err) return err
		const filename = args['filename'] as string
		const path = `${ctx.settings.workspacePath}/${filename}`
		try {
			return await ctx.memory.readWorkspaceFile(filename)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return `Error reading ${path}: ${msg}`
		}
	},
}

export const writeWorkspaceFileTool: Tool = {
	definition: {
		name: 'write_workspace_file',
		description: 'Write a file in the .lava-claw workspace folder. Allowed files: SOUL.md, IDENTITY.md, USER.md, TOOLS.md, memory.md.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				filename: {type: SchemaType.STRING, description: 'Filename to write, e.g. "SOUL.md"'},
				content: {type: SchemaType.STRING, description: 'Full content to write to the file'},
			},
			required: ['filename', 'content'],
		},
	},
	async execute(args, ctx) {
		const err = validateFilename(args['filename'])
		if (err) return err
		const filename = args['filename'] as string
		const content = args['content']
		if (typeof content !== 'string') return 'Error: content must be a string'
		await ctx.memory.writeWorkspaceFile(filename, content)
		return `Wrote ${filename}`
	},
}

export function registerWorkspaceTools(registry: import('./index').ToolRegistry): void {
	registry.register(readWorkspaceFileTool)
	registry.register(writeWorkspaceFileTool)
}
