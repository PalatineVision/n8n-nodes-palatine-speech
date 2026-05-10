import type { INodeProperties } from 'n8n-workflow';

export const SpeechFields: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'model',
		type: 'options',
		options: [
			{ name: 'Palatine_small', value: 'palatine_small', description: 'Fast, compact, efficient model for basic speech recognition tasks' },
			{
				name: 'Palatine_large_highspeed',
				value: 'palatine_large_highspeed',
				description: 'Slower, more accurate model for complex and demanding scenarios',
			},
		],
		displayOptions: { show: { resource: ['transcription'] } },
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
		displayOptions: { show: { resource: ['diarize'] } },
		default: 'json',
		description: 'Format of returned diarization result',
	},
];
