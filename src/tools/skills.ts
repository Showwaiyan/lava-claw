import {SchemaType} from '@google/generative-ai'
import type {Tool, ToolContext} from './index'

export const readSkillTool: Tool = {
	definition: {
		name: 'read_skill',
		description: 'Read a skill by name. Use to understand what a skill does before using it.',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				name: {type: SchemaType.STRING, description: 'Skill name to read'},
			},
			required: ['name'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const name = args['name']
		if (typeof name !== 'string') return 'Error: name must be a string'
		try {
			return await ctx.skills.readSkill(name)
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export const addSkillTool: Tool = {
	definition: {
		name: 'add_skill',
		description: 'Add a new skill to the skills library. Skills can be added as flat files (skills/name.md) or folder-based (skills/name/SKILL.md).',
		parameters: {
			type: SchemaType.OBJECT,
			properties: {
				name: {type: SchemaType.STRING, description: 'Skill name'},
				content: {type: SchemaType.STRING, description: 'Skill content in markdown'},
				use_folder: {type: SchemaType.BOOLEAN, description: 'Use folder format (skills/name/SKILL.md)? Default: false (flat)'},
			},
			required: ['name', 'content'],
		},
	},
	async execute(args, ctx: ToolContext) {
		const name = args['name']
		const content = args['content']
		const useFolder = args['use_folder']
		if (typeof name !== 'string') return 'Error: name must be a string'
		if (typeof content !== 'string') return 'Error: content must be a string'
		if (useFolder !== undefined && typeof useFolder !== 'boolean') return 'Error: use_folder must be a boolean'
		try {
			await ctx.skills.addSkill(name, content, useFolder ?? false)
			const path = useFolder ? `skills/${name}/SKILL.md` : `skills/${name}.md`
			return `Skill '${name}' added to ${path}`
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`
		}
	},
}

export function registerSkillsTools(registry: import('./index').ToolRegistry): void {
	registry.register(readSkillTool)
	registry.register(addSkillTool)
}
