import type { INodeProperties } from 'n8n-workflow';

import { postReceivePalatine, preSendFile, preSendSummarizeText } from './utils';

export const AiOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: { resource: ['ai'] },
		},
		options: [
			{
				name: 'Summarize File',
				value: 'summarizeFile',
				description: 'Generate an AI summary of an uploaded file',
				action: 'Summarize a file',
				routing: {
					request: {
						url: '/api/v1/ai_service/summarize_file',
						method: 'POST',
						returnFullResponse: true,
						headers: { 'Content-Type': 'multipart/form-data' },
						qs: {
							task: '={{$parameter["summarizeTask"]}}',
							prompt:
								'={{ $parameter["summarizeTask"] === "meeting_summary" ? "*" : ($parameter["prompt"] || "*") }}',
							thinking: '={{$parameter["thinking"]}}',
						},
					},
					send: {
						preSend: [
							async function preSend(this, requestOptions) {
								return await preSendFile.call(this, requestOptions);
							},
						],
					},
					output: { postReceive: [postReceivePalatine] },
				},
			},
			{
				name: 'Summarize Text',
				value: 'summarizeText',
				description: 'Generate an AI summary of provided text',
				action: 'Summarize text',
				routing: {
					request: {
						url: '/api/v1/ai_service/summarize_text',
						method: 'POST',
						returnFullResponse: true,
						headers: { 'Content-Type': 'text/plain; charset=utf-8' },
						qs: {
							task: '={{$parameter["summarizeTask"]}}',
							prompt:
								'={{ $parameter["summarizeTask"] === "meeting_summary" ? "*" : ($parameter["prompt"] || "*") }}',
							thinking: '={{$parameter["thinking"]}}',
						},
					},
					send: { preSend: [preSendSummarizeText] },
					output: { postReceive: [postReceivePalatine] },
				},
			},
		],
		default: 'summarizeFile',
	},
];

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
		displayOptions: { show: { resource: ['ai'], operation: ['summarizeFile', 'summarizeText'] } },
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		default: '',
		description: 'Custom prompt for summarization',
		displayOptions: {
			show: { resource: ['ai'], operation: ['summarizeFile', 'summarizeText'], summarizeTask: ['user_prompt'] },
		},
	},
	{
		displayName: 'Thinking',
		name: 'thinking',
		type: 'boolean',
		default: false,
		description: 'Whether enable thinking mode for improved reasoning on complex tasks',
		displayOptions: { show: { resource: ['ai'], operation: ['summarizeFile', 'summarizeText'] } },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		description: 'Text to summarize',
		displayOptions: { show: { resource: ['ai'], operation: ['summarizeText'] } },
	},
];