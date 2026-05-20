import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

import { SpeechFields, SpeechOperations } from './descriptions/speech';
import { AiFields, AiOperations } from './descriptions/ai';
import { LlmFields, LlmOperations } from './descriptions/llm';
import { CommonFields } from './descriptions/common';

import { getLlmModels } from './GenericFunctions';

const NODE_KEYWORDS =
	'n8n-community-node-package, n8n, palatine, speech-to-text, transcribe, transcription, stt, audio, ai, automation, voice-to-text, speech-recognition, audio-transcription, audio2text, audio-processing, diarization, speaker-diarization, speaker-segmentation, summarization, audio-summarization, sentiment-analysis, emotion-detection, tone-analysis, llm, chat-completions, openai-compatible, structured-output, json-schema';

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
		description:
			`Transcribe audio, diarize speakers, analyze sentiment, generate AI summaries, or use OpenAI-compatible LLM Chat Completions via Palatine. Keywords: ${NODE_KEYWORDS}`,
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
					{ name: 'Transcription', value: 'transcription' },
					{ name: 'Diarize', value: 'diarize' },
					{ name: 'Sentiment Analysis', value: 'sentiment' },
					{ name: 'Meeting Summary', value: 'ai' },
					{ name: 'LLM', value: 'llm' },
				],
				default: 'transcription',
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
