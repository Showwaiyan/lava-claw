import {Notice} from 'obsidian'
import {platform} from 'os'
import {spawn} from 'child_process'
import type {ChildProcess} from 'child_process'
import type {Service} from '../types'
import type {LavaClawSettings} from '../settings'

export class SleepPreventionService implements Service {
	readonly id = 'sleep-prevention'
	private settings: LavaClawSettings
	private process: ChildProcess | null = null

	constructor(settings: LavaClawSettings) {
		this.settings = settings
	}

	async init(): Promise<void> {
		if (!this.settings.preventSleep) return
		if (platform() !== 'darwin') return

		try {
			this.process = spawn('caffeinate', ['-i'])
			this.process.on('error', () => {
				new Notice('Lava Claw: failed to prevent sleep')
				this.process = null
			})
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Lava Claw: failed to prevent sleep: ${msg}`)
		}
	}

	async destroy(): Promise<void> {
		if (this.process) {
			try {
				this.process.kill()
			} catch {
				// process may already be dead — ignore
			}
			this.process = null
		}
	}
}
