import {SchemaType} from '@google/generative-ai'
import type {Tool} from './index'

export const readNoteTool: Tool = {
	definition: {
		name: 'read_note',
		description: 'Read the full content of a vault note by its path.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path to the note, e.g. "folder/note.md"'},
			},
			required: ['path'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		return ctx.vault.readNote(notePath)
	},
}

export const createNoteTool: Tool = {
	definition: {
		name: 'create_note',
		description: 'Create a new vault note at the given path with the given content.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path for the new note'},
				content: {type: SchemaType.STRING, description: 'Markdown content for the note'},
			},
			required: ['path', 'content'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const content = args['content']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof content !== 'string') return 'Error: content must be a string'
		await ctx.vault.createNote(notePath, content)
		return `Created note: ${notePath}`
	},
}

export const updateNoteTool: Tool = {
	definition: {
		name: 'update_note',
		description: 'Update an existing vault note. Mode "overwrite" replaces all content; "append" adds to the end.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path to the note'},
				content: {type: SchemaType.STRING, description: 'New content (overwrite) or content to append'},
				mode: {type: SchemaType.STRING, description: '"overwrite" or "append"'},
			},
			required: ['path', 'content', 'mode'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const content = args['content']
		const mode = args['mode']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof content !== 'string') return 'Error: content must be a string'
		if (mode !== 'overwrite' && mode !== 'append') return 'Error: mode must be "overwrite" or "append"'
		if (mode === 'append') {
			const existing = await ctx.vault.readNote(notePath)
			await ctx.vault.updateNote(notePath, existing + '\n' + content)
		} else {
			await ctx.vault.updateNote(notePath, content)
		}
		return `Updated note: ${notePath}`
	},
}

export const deleteNoteTool: Tool = {
	definition: {
		name: 'delete_note',
		description: 'Move a vault note to trash.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path to the note'},
			},
			required: ['path'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		await ctx.vault.deleteNote(notePath)
		return `Deleted note: ${notePath}`
	},
}

export const searchNotesTool: Tool = {
	definition: {
		name: 'search_notes',
		description: 'Search vault notes by keyword. Returns up to 5 matching notes with a preview of each.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				query: {type: SchemaType.STRING, description: 'Search query'},
			},
			required: ['query'],
		},
	},
	async execute(args, ctx) {
		const query = args['query']
		if (typeof query !== 'string') return 'Error: query must be a string'
		return ctx.vault.searchRelevant(query)
	},
}

export function registerVaultTools(registry: import('./index').ToolRegistry): void {
	registry.register(readNoteTool)
	registry.register(createNoteTool)
	registry.register(updateNoteTool)
	registry.register(deleteNoteTool)
	registry.register(searchNotesTool)
}
