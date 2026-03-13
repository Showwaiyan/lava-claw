import {SchemaType} from '@google/generative-ai'
import type {Tool} from './index'

export const readNoteTool: Tool = {
	definition: {
		name: 'read_note',
		description: 'Read the full content of a vault note by its path. Supports subfolders.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path (e.g., "Notes/readme.md", "folder/file.md")'},
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
		description: 'Create a new vault note or overwrite an existing one entirely. Supports subfolders.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path (e.g., "Notes/meeting.md", "folder/subfolder/note.md")'},
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
		description: 'Append content to the end of an existing vault note. Supports subfolders.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path (e.g., "Notes/log.md", "folder/file.md")'},
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
	registry.register(moveNoteTool)
	registry.register(copyNoteTool)
	registry.register(createFolderTool)
	registry.register(deleteFolderTool)
	registry.register(gitCloneTool)
}

export const moveNoteTool: Tool = {
	definition: {
		name: 'move_note',
		description: 'Rename or move a note to a different folder.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Current vault-relative path'},
				new_path: {type: SchemaType.STRING, description: 'New vault-relative path'},
			},
			required: ['path', 'new_path'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const newPath = args['new_path']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof newPath !== 'string') return 'Error: new_path must be a string'
		try {
			await ctx.vault.moveNote(notePath, newPath)
			return `Moved: ${notePath} → ${newPath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const copyNoteTool: Tool = {
	definition: {
		name: 'copy_note',
		description: 'Duplicate a note to a new location.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Source vault-relative path'},
				new_path: {type: SchemaType.STRING, description: 'Destination vault-relative path'},
			},
			required: ['path', 'new_path'],
		},
	},
	async execute(args, ctx) {
		const notePath = args['path']
		const newPath = args['new_path']
		if (typeof notePath !== 'string') return 'Error: path must be a string'
		if (typeof newPath !== 'string') return 'Error: new_path must be a string'
		try {
			await ctx.vault.copyNote(notePath, newPath)
			return `Copied: ${notePath} → ${newPath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const createFolderTool: Tool = {
	definition: {
		name: 'create_folder',
		description: 'Create a new folder in the vault.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path for the new folder'},
			},
			required: ['path'],
		},
	},
	async execute(args, ctx) {
		const folderPath = args['path']
		if (typeof folderPath !== 'string') return 'Error: path must be a string'
		try {
			await ctx.vault.createFolder(folderPath)
			return `Created folder: ${folderPath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const deleteFolderTool: Tool = {
	definition: {
		name: 'delete_folder',
		description: 'Delete a folder and all its contents (moves to trash).',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				path: {type: SchemaType.STRING, description: 'Vault-relative path to the folder'},
			},
			required: ['path'],
		},
	},
	async execute(args, ctx) {
		const folderPath = args['path']
		if (typeof folderPath !== 'string') return 'Error: path must be a string'
		try {
			await ctx.vault.deleteFolder(folderPath)
			return `Deleted folder: ${folderPath}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const gitCloneTool: Tool = {
	definition: {
		name: 'git_clone',
		description: 'Clone a git repository into the vault. Use for importing skills from GitHub.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				repo_url: {type: SchemaType.STRING, description: 'Git repository URL (e.g., https://github.com/user/repo)'},
				folder: {type: SchemaType.STRING, description: 'Optional: folder name to clone into (defaults to vault root)'},
			},
			required: ['repo_url'],
		},
	},
	async execute(args, ctx) {
		const repoUrl = args['repo_url']
		const folder = args['folder']
		if (typeof repoUrl !== 'string') return 'Error: repo_url must be a string'
		if (folder !== undefined && typeof folder !== 'string') return 'Error: folder must be a string'
		try {
			return await ctx.vault.gitClone(repoUrl, folder)
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}
