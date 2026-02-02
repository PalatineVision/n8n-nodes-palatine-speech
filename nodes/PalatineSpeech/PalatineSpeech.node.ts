import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type Task = 'transcribe' | 'diarize' | 'sentiment' | 'summarize';
type ResponseFormat = '' | 'srt' | 'vtt';
type SummarizeInput = 'file' | 'text';

type JsonRecord = Record<string, unknown>;

type PollDefaults = { pollIntervalMs: number; maxPollAttempts: number };
const TASK_POLL_DEFAULTS: Record<Task, PollDefaults> = {
	transcribe: { pollIntervalMs: 500, maxPollAttempts: 200 },
	diarize: { pollIntervalMs: 500, maxPollAttempts: 200 },
	sentiment: { pollIntervalMs: 500, maxPollAttempts: 200 },
	summarize: { pollIntervalMs: 20000, maxPollAttempts: 500 },
};

type MultipartFile = {
	value: Buffer;
	options: {
		filename: string;
		contentType: string;
	};
};

type FormDataValue = string | number | boolean | MultipartFile;

type HttpRequestOptionsWithFormData = IHttpRequestOptions & {
	formData?: Record<string, FormDataValue>;
};

function normalizeStatus(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isObject(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null;
}

function extractTaskId(resp: unknown): string | undefined {
	if (!isObject(resp)) return undefined;

	const taskId = resp.task_id ?? resp.taskId ?? resp.id;
	if (typeof taskId === 'string' && taskId.trim()) return taskId;

	const task = resp.task;
	if (isObject(task) && typeof task.id === 'string' && task.id.trim()) return task.id;

	return undefined;
}

function unwrapFinalPayload(payload: unknown): unknown {
	if (!isObject(payload)) return payload;
	return payload.result ?? payload.data ?? payload.output ?? payload.response ?? payload;
}

function isTerminalFailure(payload: unknown): boolean {
	if (!isObject(payload)) return false;

	const s =
		normalizeStatus(payload.status) ||
		normalizeStatus(payload.state) ||
		normalizeStatus(payload.task_status);

	return ['failed', 'error', 'canceled', 'cancelled'].includes(s);
}

function isTerminalSuccess(payload: unknown): boolean {
	if (!isObject(payload)) return false;

	const s =
		normalizeStatus(payload.status) ||
		normalizeStatus(payload.state) ||
		normalizeStatus(payload.task_status);

	if (['completed', 'done', 'success', 'finished'].includes(s)) return true;

	const hasResult = 'result' in payload || 'data' in payload || 'output' in payload || 'response' in payload;
	const looksProcessing = ['queued', 'pending', 'processing', 'running', 'in_progress'].includes(s);

	return hasResult && !looksProcessing;
}

function looksLikeSrt(text: string): boolean {
	return /\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text);
}

function looksLikeVtt(text: string): boolean {
	return (
		/^\s*WEBVTT\b/.test(text) ||
		/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(text)
	);
}

function findFirstUrl(obj: unknown): string | undefined {
	if (!isObject(obj)) return undefined;

	const seen = new Set<JsonRecord>();
	const stack: JsonRecord[] = [obj];

	while (stack.length) {
		const cur = stack.pop();
		if (!cur) continue;
		if (seen.has(cur)) continue;
		seen.add(cur);

		for (const [k, v] of Object.entries(cur)) {
			if (typeof v === 'string') {
				const key = k.toLowerCase();
				if (
					key.includes('download') ||
					key.includes('result_url') ||
					key.endsWith('url') ||
					key.includes('file_url')
				) {
					if (/^https?:\/\//i.test(v)) return v;
				}
			} else if (isObject(v)) {
				stack.push(v);
			}
		}
	}

	return undefined;
}

function toJsonError(error: unknown): JsonObject {
	if (error instanceof Error) {
		const json: JsonObject = {
			name: error.name,
			message: error.message,
		};

		if (typeof error.stack === 'string') {
			json.stack = error.stack;
		}

		return json;
	}

	if (typeof error === 'string') {
		return { message: error };
	}

	if (isObject(error)) {
		return error as unknown as JsonObject;
	}

	return { message: 'Unknown error' };
}

function toIDataObject(value: unknown): IDataObject {
	return value as unknown as IDataObject;
}

export class PalatineSpeech implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Palatine Speech',
		name: 'palatineSpeech',
		icon: {
			light: 'file:../../icons/logoLight.svg',
			dark: 'file:../../icons/logoDark.svg',
		},
		group: ['transform'],
		version: 1,
		usableAsTool: true,
		description:
			'Transcribe audio, diarize speakers, analyze sentiment, or generate AI summaries via Palatine Speech API.',
		defaults: { name: 'Palatine Speech' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'palatineSpeechNodeApi', required: true }],
		properties: [
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property that contains the input file',
			},
			{
				displayName: 'Task',
				name: 'task',
				type: 'options',
				options: [
					{ name: 'Transcribe', value: 'transcribe', description: 'Convert speech in an audio file to text' },
					{ name: 'Diarize', value: 'diarize', description: 'Split audio by speakers and return timestamps' },
					{ name: 'Sentiment Analysis', value: 'sentiment', description: 'Detect sentiment/emotion in audio' },
					{ name: 'Summarize', value: 'summarize', description: 'Generate an AI summary of audio or text' },
				],
				default: 'transcribe',
				description: 'Select what to do with the input',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'Palatine_small', value: 'palatine_small', description: 'Model used for transcription processing' },
					{
						name: 'Palatine_large_highspeed',
						value: 'palatine_large_highspeed',
						description: 'Model used for transcription processing',
					},
				],
				displayOptions: { show: { task: ['transcribe'] } },
				default: 'palatine_small',
				description: 'Model used for transcription processing',
			},
			{
				displayName: 'Response Format',
				name: 'responseFormat',
				type: 'options',
				options: [
					{ name: 'Plain Text', value: '', description: 'Return plain text (default)' },
					{ name: 'SRT', value: 'srt', description: 'SubRip subtitles (.srt)' },
					{ name: 'VTT', value: 'vtt', description: 'WebVTT subtitles (.vtt)' },
				],
				displayOptions: { show: { task: ['transcribe'] } },
				default: '',
				description: 'Format of returned result',
			},
			{
				displayName: 'Input Type',
				name: 'summarizeInput',
				type: 'options',
				options: [
					{ name: 'File', value: 'file', description: 'Summarize an uploaded file (binary)' },
					{ name: 'Text', value: 'text', description: 'Summarize provided text (no file needed)' },
				],
				default: 'file',
				description: 'Choose what to summarize',
				displayOptions: { show: { task: ['summarize'] } },
			},
			{
				displayName: 'Text',
				name: 'summarizeText',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				description: 'Text to summarize (used only when Input Type is Text)',
				displayOptions: { show: { task: ['summarize'], summarizeInput: ['text'] } },
			},
			{
				displayName: 'AI Task',
				name: 'summarizeTask',
				type: 'options',
				options: [
					{ name: 'Meeting Summary', value: 'meeting_summary', description: 'Meeting summary format' },
					{ name: 'User Prompt', value: 'user_prompt', description: 'Use a custom prompt' },
				],
				default: 'meeting_summary',
				description: 'Summarization mode',
				displayOptions: { show: { task: ['summarize'] } },
			},
			{
				displayName: 'Prompt',
				name: 'summarizePrompt',
				type: 'string',
				default: '',
				description: 'Used only with User Prompt',
				displayOptions: { show: { task: ['summarize'], summarizeTask: ['user_prompt'] } },
			},
			{
				displayName: 'Thinking',
				name: 'summarizeThinking',
				type: 'boolean',
				default: false,
				description: 'Whether to enable "thinking" mode',
				displayOptions: { show: { task: ['summarize'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Polling Interval (Ms)',
						name: 'pollIntervalMs',
						type: 'number',
						typeOptions: { minValue: 500, maxValue: 900000 },
						default: 500,
						description: 'Polling interval. Min 500, max 900000. (Summarize default: 20000).',
					},
					{
						displayName: 'Max Poll Attempts',
						name: 'maxPollAttempts',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000 },
						default: 200,
						description: 'Polling attempts. Min 1, max 1000. (Summarize default: 500).',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('palatineSpeechNodeApi');
		const baseUrl = String((credentials as JsonRecord).baseUrl ?? '').replace(/\/$/, '');

		if (!baseUrl) {
			throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty.');
		}

		const request = async (options: HttpRequestOptionsWithFormData, itemIndex: number) => {
			try {
				return await this.helpers.httpRequestWithAuthentication.call(
					this,
					'palatineSpeechNodeApi',
					options as unknown as IHttpRequestOptions,
				);
			} catch (error) {
				throw new NodeApiError(this.getNode(), toJsonError(error), { itemIndex });
			}
		};

		const getStatusUrl = (task: Task, taskId: string): string => {
			switch (task) {
				case 'transcribe':
					return `${baseUrl}/api/v1/transcribe/task_status/${taskId}`;
				case 'diarize':
					return `${baseUrl}/api/v1/diarization/task_status/${taskId}`;
				case 'sentiment':
					return `${baseUrl}/api/v1/sentiment_analysis/task_status/${taskId}`;
				case 'summarize':
					return `${baseUrl}/api/v1/ai_service/task_status/${taskId}`;
			}
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
				const task = this.getNodeParameter('task', i) as Task;

				const uiOptions = this.getNodeParameter('options', i, {}) as {
					pollIntervalMs?: number;
					maxPollAttempts?: number;
				};

				const legacyParams = (this.getNode().parameters ?? {}) as unknown as {
					pollIntervalMs?: number;
					maxPollAttempts?: number;
				};

				let pollIntervalMs = (uiOptions.pollIntervalMs ?? legacyParams.pollIntervalMs ?? 500) as number;
				let maxPollAttempts = (uiOptions.maxPollAttempts ?? legacyParams.maxPollAttempts ?? 200) as number;

				const defaults = TASK_POLL_DEFAULTS[task];

				if (task === 'summarize') {
					if (pollIntervalMs === 500 || pollIntervalMs === 1000) pollIntervalMs = defaults.pollIntervalMs;
					if (maxPollAttempts === 200 || maxPollAttempts === 300) maxPollAttempts = defaults.maxPollAttempts;
				} else {
					if (pollIntervalMs === 1000) pollIntervalMs = defaults.pollIntervalMs;
					if (maxPollAttempts === 300) maxPollAttempts = defaults.maxPollAttempts;
				}

				pollIntervalMs = Math.min(900000, Math.max(500, pollIntervalMs));
				maxPollAttempts = Math.min(1000, Math.max(1, maxPollAttempts));

				let model: string | undefined;
				let responseFormat: ResponseFormat = '';

				if (task === 'transcribe') {
					model = this.getNodeParameter('model', i) as string;
					responseFormat = (this.getNodeParameter('responseFormat', i, '') as ResponseFormat) || '';
				}

				let summarizeTask: string | undefined;
				let summarizeThinking = false;
				let summarizePromptRaw = '';
				let summarizeInput: SummarizeInput = 'file';
				let summarizeTextRaw = '';

				if (task === 'summarize') {
					summarizeInput = (this.getNodeParameter('summarizeInput', i, 'file') as SummarizeInput) || 'file';
					summarizeTask = this.getNodeParameter('summarizeTask', i) as string;
					summarizeThinking = this.getNodeParameter('summarizeThinking', i) as boolean;

					if (summarizeTask === 'user_prompt') {
						summarizePromptRaw = (this.getNodeParameter('summarizePrompt', i, '') as string) || '';
					}

					if (summarizeInput === 'text') {
						summarizeTextRaw = (this.getNodeParameter('summarizeText', i, '') as string) || '';
						if (!summarizeTextRaw.trim()) {
							throw new NodeOperationError(this.getNode(), 'Summarize (Text): "Text" is empty.', { itemIndex: i });
						}
					}
				}

				const needsFile = task !== 'summarize' || summarizeInput === 'file';

				const binaryData = needsFile ? items[i].binary?.[binaryProperty] : undefined;
				if (needsFile && !binaryData) {
					throw new NodeOperationError(this.getNode(), `No binary data in property "${binaryProperty}".`, { itemIndex: i });
				}

				let url: string;
				let qs: Record<string, string | boolean> | undefined;

				switch (task) {
					case 'transcribe':
						url = `${baseUrl}/api/v1/transcribe/do_transcribe`;
						qs = responseFormat ? { response_format: responseFormat } : undefined;
						break;

					case 'diarize':
						url = `${baseUrl}/api/v1/diarization/do_diarize`;
						break;

					case 'sentiment':
						url = `${baseUrl}/api/v1/sentiment_analysis/analyze_file`;
						break;

					case 'summarize': {
						if (!summarizeTask) {
							throw new NodeOperationError(this.getNode(), 'Summarize: summarizeTask is missing.', { itemIndex: i });
						}

						const promptToSend =
							summarizeTask === 'meeting_summary' ? '*' : (summarizePromptRaw || '').trim() || '*';

						url =
							summarizeInput === 'text'
								? `${baseUrl}/api/v1/ai_service/summarize_text`
								: `${baseUrl}/api/v1/ai_service/summarize_file`;

						qs = { task: summarizeTask, prompt: promptToSend, thinking: summarizeThinking };
						break;
					}
				}

				let createResp: unknown;

				try {
					if (task === 'summarize' && summarizeInput === 'text') {
						createResp = await request(
							{
								method: 'POST',
								url,
								qs,
								body: summarizeTextRaw,
								json: true,
							},
							i,
						);
					} else {
						const fileName = String(binaryData?.fileName || 'audio');
						const mimeType = String(binaryData?.mimeType || 'application/octet-stream');
						const fileBuffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);

						const formData: Record<string, FormDataValue> = {
							file: {
								value: fileBuffer,
								options: { filename: fileName, contentType: mimeType },
							},
						};

						if (task === 'transcribe' && model) formData.model = model;
						if (task === 'transcribe' && responseFormat) formData.response_format = responseFormat;

						createResp = await request(
							{
								method: 'POST',
								url,
								qs,
								formData,
								json: true,
							},
							i,
						);
					}
				} catch (e) {
					if (task === 'summarize' && summarizeInput === 'text') throw e;

					const fileName = String(binaryData?.fileName || 'audio');
					const mimeType = String(binaryData?.mimeType || 'application/octet-stream');
					const fileBuffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);

					const formData: Record<string, FormDataValue> = {
						file: {
							value: fileBuffer,
							options: { filename: fileName, contentType: mimeType },
						},
					};

					if (task === 'transcribe' && model) formData.model = model;
					if (task === 'transcribe' && responseFormat) formData.response_format = responseFormat;

					const raw = await request(
						{
							method: 'POST',
							url,
							qs,
							formData,
							json: false,
						},
						i,
					);

					if (typeof raw === 'string') {
						const t = raw.trim();
						const resultSync: IDataObject = { task };

						if (task === 'summarize') {
							resultSync.input_type = 'file';
							resultSync.source_file = binaryData?.fileName ?? '';
							resultSync.summary = t;
						} else if (task === 'transcribe') {
							resultSync.source_file = binaryData?.fileName ?? '';
							if (model) resultSync.model_used = model;
							if (responseFormat) {
								resultSync.response_format = responseFormat;
								resultSync.subtitles = t;
							} else {
								resultSync.transcription = t;
							}
						} else {
							resultSync.source_file = binaryData?.fileName ?? '';
							resultSync.result = t;
						}

						returnData.push({ json: resultSync, binary: items[i].binary, pairedItem: { item: i } });
						continue;
					}

					throw e;
				}

				let finalResponse: unknown = createResp;
				const taskId = extractTaskId(createResp);

				if (taskId) {
					const statusUrl = getStatusUrl(task, taskId);

					let statusPayload: unknown = null;
					let completed = false;

					for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
						statusPayload = await request({ method: 'GET', url: statusUrl, json: true }, i);

						if (isTerminalFailure(statusPayload)) {
							throw new NodeOperationError(this.getNode(), `Task ${taskId} failed.`, { itemIndex: i });
						}

						if (isTerminalSuccess(statusPayload)) {
							finalResponse = unwrapFinalPayload(statusPayload);
							completed = true;
							break;
						}

						await sleep(pollIntervalMs);
					}

					if (!completed) {
						throw new NodeOperationError(
							this.getNode(),
							`Task ${taskId} did not complete within polling limit (${maxPollAttempts} attempts).`,
							{ itemIndex: i },
						);
					}

					if (task === 'transcribe' && responseFormat) {
						try {
							const rawWithFormat = await request(
								{
									method: 'GET',
									url: statusUrl,
									qs: { response_format: responseFormat },
									json: false,
								},
								i,
							);

							if (typeof rawWithFormat === 'string') {
								const t = rawWithFormat.trim();
								if ((responseFormat === 'srt' && looksLikeSrt(t)) || (responseFormat === 'vtt' && looksLikeVtt(t))) {
									finalResponse = t;
								}
							}
						} catch {
							// Ignore.
						}

						const downloadUrl = findFirstUrl(statusPayload);
						if (downloadUrl) {
							try {
								const downloaded = await request(
									{
										method: 'GET',
										url: downloadUrl,
										qs: { response_format: responseFormat },
										json: false,
									},
									i,
								);

								if (typeof downloaded === 'string') {
									const t = downloaded.trim();
									if ((responseFormat === 'srt' && looksLikeSrt(t)) || (responseFormat === 'vtt' && looksLikeVtt(t))) {
										finalResponse = t;
									}
								}
							} catch {
								// Ignore.
							}
						}
					}
				}

				const result: IDataObject = { task };

				if (task === 'summarize') {
					result.input_type = summarizeInput;
					if (summarizeInput === 'file') result.source_file = binaryData?.fileName ?? '';
					if (summarizeInput === 'text') result.source_text_chars = summarizeTextRaw.length;

					if (typeof finalResponse === 'string') {
						result.summary = finalResponse;
					} else if (isObject(finalResponse)) {
						result.summary = toIDataObject(finalResponse);
					} else {
						result.summary = String(finalResponse ?? '');
					}
				} else if (task === 'transcribe') {
					result.source_file = binaryData?.fileName ?? '';
					if (model) result.model_used = model;
					if (responseFormat) result.response_format = responseFormat;

					if (responseFormat && typeof finalResponse === 'string') {
						result.subtitles = finalResponse.trim();
					} else if (typeof finalResponse === 'string') {
						result.transcription = finalResponse.trim();
					} else if (isObject(finalResponse)) {
						const t = finalResponse.text ?? finalResponse.transcription;
						result.transcription = typeof t === 'string' ? t : '';
					} else {
						result.transcription = '';
					}
				} else if (task === 'diarize') {
					result.source_file = binaryData?.fileName ?? '';
					result.diarization = isObject(finalResponse) ? toIDataObject(finalResponse) : String(finalResponse ?? '');
				} else if (task === 'sentiment') {
					result.source_file = binaryData?.fileName ?? '';
					result.sentiment = isObject(finalResponse) ? toIDataObject(finalResponse) : String(finalResponse ?? '');
				}

				returnData.push({ json: result, binary: items[i].binary, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: message } as IDataObject, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
