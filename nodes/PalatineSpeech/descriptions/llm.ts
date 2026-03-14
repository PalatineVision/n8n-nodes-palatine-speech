import type { INodeProperties } from 'n8n-workflow';

import { postReceiveLlmChat, postReceiveLlmModels, preSendChatCompletions } from './utils';

export const LlmOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: { resource: ['llm'] },
		},
		options: [
			{
				name: 'Chat Completions',
				value: 'chatCompletions',
				description: 'Send a chat conversation and get a model response (OpenAI-compatible)',
				action: 'Create chat completion',
				routing: {
					request: {
						url: '/api/llm/v1/chat/completions',
						method: 'POST',
						returnFullResponse: true,
					},
					send: {
						preSend: [preSendChatCompletions],
					},
					output: {
						postReceive: [postReceiveLlmChat],
					},
				},
			},
			{
				name: 'List Models',
				value: 'listModels',
				description: 'Get a list of available LLM models',
				action: 'List LLM models',
				routing: {
					request: {
						url: '/api/llm/v1/models',
						method: 'GET',
						returnFullResponse: true,
					},
					output: {
						postReceive: [postReceiveLlmModels],
					},
				},
			},
		],
		default: 'chatCompletions',
	},
];

export const LlmFields: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'llmModel',
		type: 'string',
		default: 'palatine:m',
		description: 'Model ID (for example: palatine:m). Use “List Models” to see available IDs.',
		displayOptions: { show: { resource: ['llm'], operation: ['chatCompletions'] } },
		required: true,
	},

	{
		displayName: 'System Prompt',
		name: 'systemPrompt',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'Optional system instruction (role=system)',
		displayOptions: { show: { resource: ['llm'], operation: ['chatCompletions'] } },
	},

	{
		displayName: 'User Message',
		name: 'userMessage',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		description: 'The main user message (role=user)',
		displayOptions: { show: { resource: ['llm'], operation: ['chatCompletions'] } },
		required: true,
	},

	{
		displayName: 'Conversation History',
		name: 'history',
		type: 'fixedCollection',
		default: {},
		placeholder: 'Add message',
		typeOptions: { multipleValues: true },
		description: 'Optional extra messages appended after System Prompt and before User Message',
		displayOptions: { show: { resource: ['llm'], operation: ['chatCompletions'] } },
		options: [
			{
				name: 'message',
				displayName: 'Message',
				values: [
					{
						displayName: 'Role',
						name: 'role',
						type: 'options',
						default: 'assistant',
						options: [
							{ name: 'System', value: 'system' },
							{ name: 'User', value: 'user' },
							{ name: 'Assistant', value: 'assistant' },
						],
					},
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
					},
				],
			},
		],
	},

	{
		displayName: 'Additional Options',
		name: 'llmOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['llm'], operation: ['chatCompletions'] } },
		options: [
			// ORDER REQUIRED BY LINTER:
			// Format (Ollama JSON) | Max Tokens | Response Format (JSON) | Response Format Mode | Temperature | Thinking
			{
				displayName: 'Format (Ollama JSON)',
				name: 'format',
				type: 'json',
				default: '{}',
				description: 'Optional structured output schema in Ollama-format (advanced)',
			},
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				default: 512,
				typeOptions: { minValue: 1, maxValue: 32768 },
				description: 'Maximum number of tokens in the completion',
			},
			{
				displayName: 'Response Format (JSON)',
				name: 'responseFormatJson',
				type: 'json',
				default: '{}',
				displayOptions: { show: { responseFormatMode: ['custom'] } },
				description: 'Raw response_format object, for example {"type":"json_object"}',
			},
			{
				displayName: 'Response Format Mode',
				name: 'responseFormatMode',
				type: 'options',
				default: 'none',
				options: [
					{ name: 'None (Text)', value: 'none' },
					{ name: 'JSON Object', value: 'json_object' },
					{ name: 'Custom JSON (Advanced)', value: 'custom' },
				],
				description: 'How to set response_format for the model output',
			},
			{
				displayName: 'Temperature',
				name: 'temperature',
				type: 'number',
				default: 1.0,
				typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
				description: 'Sampling temperature (0–2)',
			},
			{
				displayName: 'Thinking',
				name: 'thinking',
				type: 'boolean',
				default: false,
				description: 'Whether to enable extended reasoning mode (may increase latency and token usage)',
			},
		],
	},
];