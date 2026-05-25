import type { INodeProperties } from 'n8n-workflow';

import { postReceivePalatine, preSendFile, preSendTranscribe } from './utils';

export const SpeechOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: { resource: ['audio'] },
		},
		options: [
			{
				name: 'Transcribe',
				value: 'transcribe',
				description: 'Convert speech in an audio file to text',
				action: 'Transcribe audio',
				routing: {
					request: {
						url: '/api/v1/transcribe/do_transcribe',
						method: 'POST',
						returnFullResponse: true,
						headers: { 'Content-Type': 'multipart/form-data' },
					},
					send: { preSend: [preSendTranscribe] },
					output: { postReceive: [postReceivePalatine] },
				},
			},
			{
				name: 'Diarize',
				value: 'diarize',
				description: 'Split audio by speakers and return timestamps',
				action: 'Diarize speakers',
				routing: {
					request: {
						url: '/api/v1/diarization/do_diarize',
						method: 'POST',
						returnFullResponse: true,
						headers: { 'Content-Type': 'multipart/form-data' },
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
				name: 'Sentiment Analysis',
				value: 'sentiment',
				description: 'Detect sentiment/emotion in audio',
				action: 'Analyze sentiment',
				routing: {
					request: {
						url: '/api/v1/sentiment_analysis/analyze_file',
						method: 'POST',
						returnFullResponse: true,
						headers: { 'Content-Type': 'multipart/form-data' },
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
		],
		default: 'transcribe',
	},
];

export const SpeechFields: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'model',
		type: 'options',
		options: [
			{
				name: 'Palatine_small',
				value: 'palatine_small',
				description: 'Fast, compact, efficient model for basic speech recognition tasks',
			},
			{
				name: 'Palatine_large_highspeed',
				value: 'palatine_large_highspeed',
				description: 'Slower, more accurate model for complex and demanding scenarios',
			},
		],
		displayOptions: { show: { resource: ['audio'], operation: ['transcribe'] } },
		default: 'palatine_small',
		description: 'Model used for transcription processing',
	},
	{
		displayName: 'Response Format',
		name: 'responseFormat',
		type: 'options',
		options: [
			{ name: 'JSON', value: 'json', description: 'Return JSON' },
			{ name: 'SRT', value: 'srt', description: 'SubRip subtitles (.srt)' },
			{ name: 'VTT', value: 'vtt', description: 'WebVTT subtitles (.vtt)' },
		],
		displayOptions: { show: { resource: ['audio'], operation: ['diarize'] } },
		default: 'json',
		description: 'Format of returned diarization result',
	},
];
