import type { IDataObject, IExecuteSingleFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type TaskKind = 'transcribe' | 'diarize' | 'sentiment' | 'summarize';

export type PollingConfig = {
	pollIntervalMs: number;
	maxPollAttempts: number;
	maxWaitMs: number;
};

function readNumber(
	this: IExecuteSingleFunctions,
	options: IDataObject,
	name: string,
	fallback: number,
	minimum: number,
	maximum: number,
	integer = false,
): number {
	const raw = options[name];
	if (raw === undefined) return fallback;
	const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
	if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
		throw new NodeOperationError(
			this.getNode(),
			`Polling option "${name}" must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}.`,
		);
	}
	return value;
}

export function getPollingConfig(this: IExecuteSingleFunctions, taskKind: TaskKind): PollingConfig {
	const options = (this.getNodeParameter('polling', {}) as IDataObject) ?? {};
	const isSummary = taskKind === 'summarize';
	const pollIntervalMs = readNumber.call(this, options, 'pollIntervalMs', isSummary ? 20000 : 5000, 500, 900000, true);
	const maxPollAttempts = readNumber.call(this, options, 'maxPollAttempts', 0, 0, 1000000, true);
	const maxWaitSeconds = readNumber.call(this, options, 'maxWaitSeconds', 0, 0, 604800);
	const audioDurationSeconds = this.getNodeParameter('operation', '') === 'summarizeText'
		? 0
		: readNumber.call(this, options, 'audioDurationSeconds', 0, 0, 604800);

	// Duration is supplied explicitly (including via an n8n expression), never inferred from file size.
	// This is a waiting budget, not a prediction of API processing speed.
	const automaticWaitSeconds = Math.min(604800, Math.max(isSummary ? 10000 : 1800, audioDurationSeconds * 2 + 300));
	return {
		pollIntervalMs,
		maxPollAttempts,
		maxWaitMs: Math.ceil((maxWaitSeconds || automaticWaitSeconds) * 1000),
	};
}
