import type { INodeProperties } from 'n8n-workflow';

export const AiFields: INodeProperties[] = [
	{
		displayName: 'Summarize Mode',
		name: 'summarizeTask',
		type: 'options',
		options: [
			{ name: 'Meeting Summary', value: 'meeting_summary', description: 'Meeting summary output format' },
			{ name: 'User Prompt', value: 'user_prompt', description: 'Use custom prompt' },
		],
		default: 'meeting_summary',
		description: 'Summarization mode',
		displayOptions: { show: { operation: ['summarizeFile', 'summarizeText'] } },
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		default: '',
		description: 'Custom prompt for summarization',
		displayOptions: {
			show: { operation: ['summarizeFile', 'summarizeText'], summarizeTask: ['user_prompt'] },
		},
	},
	{
		displayName: 'Thinking',
		name: 'thinking',
		type: 'boolean',
		default: false,
		description: 'Whether enable thinking mode for improved reasoning on complex tasks',
		displayOptions: { show: { operation: ['summarizeFile', 'summarizeText'] } },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		description: 'Text to summarize',
		displayOptions: { show: { operation: ['summarizeText'] } },
	},
];
