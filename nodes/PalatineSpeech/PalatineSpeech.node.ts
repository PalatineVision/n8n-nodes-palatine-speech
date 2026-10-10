import type { INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { SpeechFields, SpeechOperations } from './descriptions/speech';
import { AiFields } from './descriptions/ai';
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
		version: [3],
		defaultVersion: 3,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:'An n8n community node for integrating Palatine Speech into automation workflows. It enables audio and video processing tasks such as transcription, speaker diarization, sentiment analysis, summarization, and LLM-based processing directly inside n8n.',
		defaults: { name: 'Palatine Speech' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
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
					{ name: 'Audio', value: 'audio' },
					{ name: 'LLM', value: 'llm' },
				],
				default: 'audio',
			},

			...SpeechOperations,
			...LlmOperations,

			...SpeechFields,
			...AiFields,
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
