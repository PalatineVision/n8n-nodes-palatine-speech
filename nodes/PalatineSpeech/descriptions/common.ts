import type { INodeProperties } from 'n8n-workflow';

function pollingOptions(interval: number): INodeProperties[] {
	return [
		{
			displayName: 'Max Wait Time (Seconds)',
			name: 'maxWaitSeconds',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 604800 },
			default: 0,
			description: 'Maximum elapsed time to wait for a result, including status requests. 0 calculates a waiting budget from Audio Duration, or uses 30 minutes for audio and 10000 seconds for summaries when duration is unknown. Does not include the initial upload.',
		},
		{
			displayName: 'Polling Interval (Ms)',
			name: 'pollIntervalMs',
			type: 'number',
			typeOptions: { minValue: 500, maxValue: 900000, numberPrecision: 0 },
			default: interval,
			description: 'Delay between status requests in milliseconds. Explicit values are used as entered.',
		},
		{
			displayName: 'Audio Duration (Seconds)',
			name: 'audioDurationSeconds',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 604800 },
			default: 0,
			displayOptions: { hide: { '/operation': ['summarizeText'] } },
			description: 'Duration from an upstream node, optionally supplied as an expression. With automatic wait time, allows twice the duration plus 5 minutes, with a minimum of 30 minutes for audio or 10000 seconds for summaries and a maximum of 7 days. 0 means unknown.',
		},
		{
			displayName: 'Max Poll Attempts',
			name: 'maxPollAttempts',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 1000000, numberPrecision: 0 },
			default: 0,
			description: 'Optional additional limit on status requests. 0 uses only the wait time limit. A saved nonzero limit is preserved and can stop polling earlier.',
		},
	];
}

export const CommonFields: INodeProperties[] = [
	{
		displayName: 'Binary Property',
		name: 'binaryProperty',
		type: 'string',
		default: 'data',
		description: 'Name of the binary property that contains the input file',
		displayOptions: {
			show: {
				resource: ['audio'],
				operation: ['transcribe', 'diarize', 'sentiment'],
			},
		},
		required: true,
	},
	{
		displayName: 'Binary Property',
		name: 'binaryProperty',
		type: 'string',
		default: 'data',
		description: 'Name of the binary property that contains the input file',
		displayOptions: {
			show: {
				operation: ['summarizeFile'],
			},
		},
		required: true,
	},

	{
		displayName: 'Polling Options',
		name: 'polling',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: {
			show: {
				resource: ['audio'],
				operation: ['transcribe', 'diarize', 'sentiment'],
			},
		},
		options: pollingOptions(5000),
	},

	{
		displayName: 'Polling Options',
		name: 'polling',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: {
			show: {
				operation: ['summarizeFile', 'summarizeText'],
			},
		},
		options: pollingOptions(20000),
	},
];
