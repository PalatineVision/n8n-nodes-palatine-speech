import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

import { SpeechFields, SpeechOperations } from './descriptions/speech';
import { AiFields, AiOperations } from './descriptions/ai';
import { LlmFields, LlmOperations } from './descriptions/llm';
import { CommonFields } from './descriptions/common';

import { getLlmModels } from './GenericFunctions';

export class PalatineSpeech implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Palatine Speech',
		name: 'palatineSpeech',
		icon: {
			light: 'file:../../icons/logoLight.svg',
			dark: 'file:../../icons/logoDark.svg',
		},
		group: ['transform'],
		version: 3,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Transcribe audio, diarize speakers, analyze sentiment, generate AI summaries, or use OpenAI-compatible LLM Chat Completions via Palatine.',
		defaults: { name: 'Palatine Speech' },
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'palatineSpeechNodeApi', required: true }],
		requestDefaults: {
			method: 'POST',
			baseURL:
				'={{ ($credentials.baseUrl || "").endsWith("/") ? ($credentials.baseUrl || "").slice(0, -1) : ($credentials.baseUrl || "") }}',
			headers: {
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Speech', value: 'speech' },
					{ name: 'Meeting Summary', value: 'ai' },
					{ name: 'LLM', value: 'llm' },
				],
				default: 'speech',
			},

			...SpeechOperations,
			...SpeechFields,

			...AiOperations,
			...AiFields,

			...LlmOperations,
			...LlmFields,

			...CommonFields,
		],
	};

	methods = {
		listSearch: {
			getLlmModels,
		},
	};
}