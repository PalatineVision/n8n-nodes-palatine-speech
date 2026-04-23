import type { INodeProperties } from 'n8n-workflow';

export const CommonFields: INodeProperties[] = [
	{
		displayName: 'Binary Property',
		name: 'binaryProperty',
		type: 'string',
		default: 'data',
		description: 'Name of the binary property that contains the input file',
		displayOptions: {
			show: {
				resource: ['speech', 'ai'],
				operation: ['transcribe', 'diarize', 'sentiment', 'summarizeFile'],
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
				resource: ['speech'],
				operation: ['transcribe', 'diarize', 'sentiment'],
			},
		},
		options: [
			{
				displayName: 'Polling Interval (Ms)',
				name: 'pollIntervalMs',
				type: 'number',
				typeOptions: { minValue: 500, maxValue: 900000 },
				default: 500,
				description: 'Polling interval. Min 500, max 900000.',
			},
			{
				displayName: 'Max Poll Attempts',
				name: 'maxPollAttempts',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 200,
				description: 'Polling attempts. Min 1, max 1000.',
			},
		],
	},

	{
		displayName: 'Polling Options',
		name: 'polling',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: {
			show: {
				resource: ['ai'],
				operation: ['summarizeFile', 'summarizeText'],
			},
		},
		options: [
			{
				displayName: 'Polling Interval (Ms)',
				name: 'pollIntervalMs',
				type: 'number',
				typeOptions: { minValue: 500, maxValue: 900000 },
				default: 20000,
				description: 'Polling interval. Min 500, max 900000.',
			},
			{
				displayName: 'Max Poll Attempts',
				name: 'maxPollAttempts',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 500,
				description: 'Polling attempts. Min 1, max 1000.',
			},
		],
	},
];
