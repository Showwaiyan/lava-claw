import {SchemaType} from '@google/generative-ai'
import type {Tool} from './index'

export const readNoteTool: Tool = {
	definition: {
		name: 'read_note',
		description: 'Read the full content of a vault note by its path.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path, e.g. "folder/note.md"'},
			},
			required: ['path'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		try {
			return await ctx.vault.readNote(notePath)
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const writeNoteTool: Tool = {
	definition: {
		name: 'write_note',
		description: 'Create a new vault note or overwrite an existing one entirely.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path for the note'},
				content: {type: SchemaType.STRING, description: 'Full markdown content'},
			},
			required: ['path', 'content'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const content = args['content']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof content !== 'string') return 'Error: content must be a string'
		try {
			await ctx.vault.writeNote(notePath, content)
			return `Written: ${notePath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const appendNoteTool: Tool = {
	definition: {
		name: 'append_note',
		description: 'Append content to the end of an existing vault note.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path to the note'},
				content: {type: SchemaType.STRING, description: 'Content to append'},
			},
			required: ['path', 'content'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const content = args['content']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof content !== 'string') return 'Error: content must be a string'
		try {
			await ctx.vault.appendNote(notePath, content)
			return `Appended to: ${notePath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const patchNoteTool: Tool = {
	definition: {
		name: 'patch_note',
		description: 'Find and replace text within a vault note. Replaces the first occurrence of old_string with new_string.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path to the note'},
				old_string: {type: SchemaType.STRING, description: 'The exact string to find'},
				new_string: {type: SchemaType.STRING, description: 'The replacement string'},
			},
			required: ['path', 'old_string', 'new_string'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const oldStr = args['old_string']
		const newStr = args['new_string']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof oldStr !== 'string') return 'Error: old_string must be a string'
		if (typeof newStr !== 'string') return 'Error: new_string must be a string'
		try {
			await ctx.vault.patchNote(notePath, oldStr, newStr)
			return `Patched: ${notePath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const searchVaultTool: Tool = {
	definition: {
		name: 'search_vault',
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
		const result = await ctx.vault.searchRelevant(query)
		return result || 'No matching notes found.'
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
		try {
			await ctx.vault.deleteNote(notePath)
			return `Deleted: ${notePath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export function registerVaultTools(registry: import('./index').ToolRegistry): void {
	registry.register(readNoteTool)
	registry.register(writeNoteTool)
	registry.register(appendNoteTool)
	registry.register(patchNoteTool)
	registry.register(searchVaultTool)
	registry.register(deleteNoteTool)
}
