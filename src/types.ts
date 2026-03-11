export interface Service {
	init(): Promise<void>
	destroy(): Promise<void>
}

export interface ConversationTurn {
	role: 'user' | 'assistant'
	content: string
	timestamp: number
}

export interface Prompt {
	system: string
	memory: string
	vaultContext: string
	skills: string[]
	history: ConversationTurn[]
	message: string
}

export interface MessageSource {
	id: string
	reply(turn: ConversationTurn): Promise<void>
}

export interface LLMProvider extends Service {
	complete(prompt: Prompt): AsyncGenerator<string>
}

export interface SkillFile {
	name: string
	path: string
	content: string
}

export interface VaultPermissions {
	read: boolean
	create: boolean
	update: boolean
	delete: boolean
}

export class PermissionError extends Error {
	constructor(operation: string) {
		super(`Permission denied: vault '${operation}' permission is disabled`)
		this.name = 'PermissionError'
	}
}
