import type { INodeProperties } from 'n8n-workflow';

export const LlmFields: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'llmModel',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'Model to use',
		displayOptions: { show: { resource: ['llm'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a model...',
				typeOptions: {
					searchListMethod: 'getLlmModels',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. palatine:m',
			},
		],
	},

	{
		displayName: 'Thinking',
		name: 'thinking',
		type: 'boolean',
		default: false,
		description: 'Whether to enable extended reasoning mode (may increase latency and token usage)',
		displayOptions: { show: { resource: ['llm'] } },
	},

	{
		displayName: 'Response Format Type',
		name: 'responseFormatType',
		type: 'options',
		default: 'text',
		options: [
			{ name: 'Text', value: 'text' },
			{ name: 'JSON Object', value: 'json_object' },
			{ name: 'JSON Schema', value: 'json_schema' },
		],
		description: 'How the model should format its response',
		displayOptions: { show: { resource: ['llm'] } },
	},

	{
		displayName: 'JSON Schema',
		name: 'responseJsonSchema',
		type: 'json',
		default: `{
  "name": "response",
  "schema": {
    "type": "object",
    "properties": {
      "answer": { "type": "string" }
    },
    "required": ["answer"],
    "additionalProperties": false
  }
}`,
		description: 'Schema used when Response Format Type is JSON Schema',
		displayOptions: {
			show: {
				resource: ['llm'],
				responseFormatType: ['json_schema'],
			},
		},
	},

	{
		displayName: 'System Prompt',
		name: 'systemPrompt',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'Optional system instruction',
		displayOptions: { show: { resource: ['llm'] } },
	},

	{
		displayName: 'User Message',
		name: 'userMessage',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		description: 'The main user message',
		displayOptions: { show: { resource: ['llm'] } },
	},
	    
	{
		displayName: 'Additional Options',
		name: 'llmOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['llm'] } },
		options: [
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				default: 512,
				typeOptions: { minValue: 1, maxValue: 32768 },
				description: 'Maximum number of tokens in the completion',
			},
			{
				displayName: 'Temperature',
				name: 'temperature',
				type: 'number',
				default: 1.0,
				typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
				description: 'Sampling temperature (0-2)',
			},
		],
	},
];

