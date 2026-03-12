import {SchemaType} from '@google/generative-ai'
import {TFile} from 'obsidian'
import type {Tool} from './index'

export const openNoteTool: Tool = {
	definition: {
		name: 'open_note',
		description: 'Open a vault note in the Obsidian editor.',
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
		const file = ctx.app.vault.getFileByPath(notePath)
		if (!(file instanceof TFile)) return `Error: Note not found: ${notePath}`
		const leaf = ctx.app.workspace.getLeaf(false)
		if (!leaf) return 'Error: No workspace leaf available'
		await leaf.openFile(file)
		return `Opened: ${notePath}`
	},
}

export const getOpenNotesTool: Tool = {
	definition: {
		name: 'get_open_notes',
		description: 'Get a list of all currently open notes in the Obsidian workspace.',
		parameters: {type: SchemaType.OBJECT, properties: {}, required: []},
	},
	async execute(_args, ctx) {
		const leaves = ctx.app.workspace.getLeavesOfType('markdown')
		if (leaves.length === 0) return 'No notes currently open.'
		const paths = leaves
			.map(leaf => (leaf.view as unknown as {file?: TFile}).file?.path)
			.filter((p): p is string => typeof p === 'string')
		return paths.join('\n')
	},
}

export function registerWorkspaceTools(registry: import('./index').ToolRegistry): void {
	registry.register(openNoteTool)
	registry.register(getOpenNotesTool)
}
