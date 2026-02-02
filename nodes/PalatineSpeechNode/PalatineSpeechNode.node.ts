import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type Task = 'transcribe' | 'diarize' | 'sentiment' | 'summarize';
type ResponseFormat = '' | 'srt' | 'vtt';
type SummarizeInput = 'file' | 'text';

const TASK_POLL_DEFAULTS: Record<Task, { pollIntervalMs: number; maxPollAttempts: number }> = {
	transcribe: { pollIntervalMs: 500, maxPollAttempts: 200 },
	diarize: { pollIntervalMs: 500, maxPollAttempts: 200 },
	sentiment: { pollIntervalMs: 500, maxPollAttempts: 200 },
	summarize: { pollIntervalMs: 20000, maxPollAttempts: 500 },
};

function createMultipartFormData(
	fileBuffer: Buffer,
	fileName: string,
	mimeType: string,
	extraFields?: Record<string, string>,
): any {
	const FormDataCtor = (globalThis as any).FormData;
	const BlobCtor = (globalThis as any).Blob;

	if (!FormDataCtor || !BlobCtor) {
		throw new Error('FormData/Blob is not available. Please update Node.js/n8n runtime.');
	}

	const form = new FormDataCtor();
	const blob = new BlobCtor([fileBuffer], { type: mimeType || 'application/octet-stream' });

	form.append('file', blob, fileName);

	if (extraFields) {
		for (const [k, v] of Object.entries(extraFields)) {
			if (v !== undefined && v !== null) form.append(k, String(v));
		}
	}

	return form;
}

export class PalatineSpeechNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Palatine Speech',
		name: 'palatineSpeech',
		icon: {
			light: 'file:logoLight.svg',
			dark: 'file:logoDark.svg',
		},
		group: ['transform'],
		version: 1,
		description:
			'Use Palatine Speech API to transcribe audio, diarize speakers, analyze sentiment, generate AI summaries and more',
		defaults: { name: 'Palatine Speech' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'PalatineSpeechNodeApi', required: true }],
		properties: [
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property that contains the input file (used for file-based tasks)',
			},
			{
				displayName: 'Task',
				name: 'task',
				type: 'options',
				options: [
					{ name: 'Transcribe', value: 'transcribe', description: 'Convert speech in audio file to text' },
					{ name: 'Diarize', value: 'diarize', description: 'Split audio by speakers and return timestamps' },
					{ name: 'Sentiment Analysis', value: 'sentiment', description: 'Detect sentiment/emotion in audio' },
					{ name: 'Summarize', value: 'summarize', description: 'Generate an AI summary of audio or text' },
				],
				default: 'transcribe',
				description: 'Select what to do with input',
			},

			// Transcribe-only
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'palatine_small', value: 'palatine_small', description: 'Model used for transcription processing' },
					{
						name: 'palatine_large_highspeed',
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
				description: "Format of returned result. Supported: 'srt' and 'vtt'",
			},

			// Summarize-only
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
				description: 'Text to summarize (used only when Input Type = Text)',
				displayOptions: { show: { task: ['summarize'], summarizeInput: ['text'] } },
			},
			{
				displayName: 'AI Task',
				name: 'summarizeTask',
				type: 'options',
				options: [
					{ name: 'Meeting Summary', value: 'meeting_summary', description: 'Meeting summary format' },
					{ name: 'User Prompt', value: 'user_prompt', description: 'Use custom prompt' },
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
				description: 'Used only with "User Prompt"',
				displayOptions: { show: { task: ['summarize'], summarizeTask: ['user_prompt'] } },
			},
			{
				displayName: 'Thinking',
				name: 'summarizeThinking',
				type: 'boolean',
				default: false,
				description: 'Enable "thinking" mode',
				displayOptions: { show: { task: ['summarize'] } },
			},

			// Options (keep at bottom)
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Polling Interval (ms)',
						name: 'pollIntervalMs',
						type: 'number',
						typeOptions: { minValue: 500, maxValue: 900000 },
						default: 500,
						description: 'Polling interval. Min 500, max 900000. (Summarize default: 20000)',
					},
					{
						displayName: 'Max Poll Attempts',
						name: 'maxPollAttempts',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000 },
						default: 200,
						description: 'Polling attempts. Min 1, max 1000. (Summarize default: 500)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('PalatineSpeechNodeApi');
		const baseUrl = String((credentials as any).baseUrl || '').replace(/\/$/, '');
		if (!baseUrl) throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty');

		const request = async (options: IHttpRequestOptions, itemIndex: number) => {
			try {
				return await this.helpers.httpRequestWithAuthentication.call(this, 'PalatineSpeechNodeApi', options);
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as any, { itemIndex });
			}
		};

		const extractTaskId = (resp: any): string | undefined => {
			if (!resp || typeof resp !== 'object') return undefined;
			return resp.task_id || resp.taskId || resp.id || resp.task?.id;
		};

		const normalizeStatus = (s: any): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

		const isTerminalSuccess = (p: any): boolean => {
			const s = normalizeStatus(p?.status) || normalizeStatus(p?.state) || normalizeStatus(p?.task_status);
			if (['completed', 'done', 'success', 'finished'].includes(s)) return true;

			const hasResult = p?.result !== undefined || p?.data !== undefined || p?.output !== undefined || p?.response !== undefined;
			const looksProcessing = ['queued', 'pending', 'processing', 'running', 'in_progress'].includes(s);
			return hasResult && !looksProcessing;
		};

		const isTerminalFailure = (p: any): boolean => {
			const s = normalizeStatus(p?.status) || normalizeStatus(p?.state) || normalizeStatus(p?.task_status);
			return ['failed', 'error', 'canceled', 'cancelled'].includes(s);
		};

		const unwrapFinalPayload = (p: any): any => p?.result ?? p?.data ?? p?.output ?? p?.response ?? p;

		const looksLikeSrt = (t: string) =>
			/\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(t);

		const looksLikeVtt = (t: string) =>
			/^\s*WEBVTT\b/.test(t) || /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(t);

		const findFirstUrl = (obj: any): string | undefined => {
			const seen = new Set<any>();
			const stack: any[] = [obj];

			while (stack.length) {
				const cur = stack.pop();
				if (!cur || typeof cur !== 'object') continue;
				if (seen.has(cur)) continue;
				seen.add(cur);

				for (const [k, v] of Object.entries(cur)) {
					if (typeof v === 'string') {
						const key = k.toLowerCase();
						if (key.includes('download') || key.includes('result_url') || key.endsWith('url') || key.includes('file_url')) {
							if (/^https?:\/\//i.test(v)) return v;
						}
					} else if (v && typeof v === 'object') {
						stack.push(v);
					}
				}
			}
			return undefined;
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
				default:
					return `${baseUrl}/api/v1/transcribe/task_status/${taskId}`;
			}
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
				const task = this.getNodeParameter('task', i) as Task;

				const uiOptions =
					(this.getNodeParameter('options', i, {}) as { pollIntervalMs?: number; maxPollAttempts?: number }) ?? {};
				const legacyParams = (this.getNode().parameters || {}) as { pollIntervalMs?: number; maxPollAttempts?: number };

				let pollIntervalMs = (uiOptions.pollIntervalMs ?? legacyParams.pollIntervalMs ?? 500) as number;
				let maxPollAttempts = (uiOptions.maxPollAttempts ?? legacyParams.maxPollAttempts ?? 200) as number;

				const taskDefaults = TASK_POLL_DEFAULTS[task];
				if (task === 'summarize') {
					if (pollIntervalMs === 500 || pollIntervalMs === 1000) pollIntervalMs = taskDefaults.pollIntervalMs;
					if (maxPollAttempts === 200 || maxPollAttempts === 300) maxPollAttempts = taskDefaults.maxPollAttempts;
				} else {
					if (pollIntervalMs === 1000) pollIntervalMs = taskDefaults.pollIntervalMs;
					if (maxPollAttempts === 300) maxPollAttempts = taskDefaults.maxPollAttempts;
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
							throw new NodeOperationError(this.getNode(), 'Summarize (Text): "Text" is empty', { itemIndex: i });
						}
					}
				}

				const needsFile = task !== 'summarize' || summarizeInput === 'file';

				let binaryData: any | undefined;
				if (needsFile) {
					binaryData = items[i].binary?.[binaryProperty];
					if (!binaryData) {
						throw new NodeOperationError(this.getNode(), `No binary data in property "${binaryProperty}"`, { itemIndex: i });
					}
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
							throw new NodeOperationError(this.getNode(), 'Summarize: summarizeTask is missing', { itemIndex: i });
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

					default:
						throw new NodeOperationError(this.getNode(), `Unknown task: ${task}`, { itemIndex: i });
				}

				let createResp: any;

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
						const fileName = binaryData.fileName || 'audio';
						const mimeType = binaryData.mimeType || 'application/octet-stream';
						const fileBuffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);

						const form = createMultipartFormData(fileBuffer, fileName, mimeType, task === 'transcribe' && model ? { model } : undefined);

						// Some backends accept response_format in form
						if (task === 'transcribe' && responseFormat) {
							form.append('response_format', responseFormat);
						}

						createResp = await request(
							{
								method: 'POST',
								url,
								qs,
								body: form,
								json: true,
							},
							i,
						);
					}
				} catch (e) {
					if (task === 'summarize' && summarizeInput === 'text') throw e;

					// Retry as raw (sync plain text/subtitles responses)
					const fileName = binaryData?.fileName || 'audio';
					const mimeType = binaryData?.mimeType || 'application/octet-stream';
					const fileBuffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);

					const form = createMultipartFormData(fileBuffer, fileName, mimeType, task === 'transcribe' && model ? { model } : undefined);

					if (task === 'transcribe' && responseFormat) {
						form.append('response_format', responseFormat);
					}

					const raw = await request(
						{
							method: 'POST',
							url,
							qs,
							body: form,
							json: false,
						},
						i,
					);

					if (typeof raw === 'string') {
						const t = raw.trim();
						const resultSync: Record<string, any> = { task };

						if (task === 'summarize') {
							resultSync.input_type = 'file';
							resultSync.source_file = binaryData?.fileName;
							resultSync.summary = t;
						} else if (task === 'transcribe') {
							resultSync.source_file = binaryData?.fileName;
							if (model) resultSync.model_used = model;
							if (responseFormat) {
								resultSync.response_format = responseFormat;
								resultSync.subtitles = t;
							} else {
								resultSync.transcription = t;
							}
						} else {
							resultSync.source_file = binaryData?.fileName;
							resultSync.result = t;
						}

						returnData.push({ json: resultSync, binary: items[i].binary, pairedItem: { item: i } });
						continue;
					}

					throw e;
				}

				let finalResponse: any = createResp;
				const taskId = extractTaskId(createResp);

				if (taskId) {
					const statusUrl = getStatusUrl(task, taskId);

					let statusPayload: any = null;
					let completed = false;

					for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
						statusPayload = await request({ method: 'GET', url: statusUrl, json: true }, i);

						if (isTerminalFailure(statusPayload)) {
							throw new NodeOperationError(
								this.getNode(),
								`Task ${taskId} failed: ${statusPayload?.error || statusPayload?.message || JSON.stringify(statusPayload)}`,
								{ itemIndex: i },
							);
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
							`Task ${taskId} did not complete within polling limit (${maxPollAttempts} attempts)`,
							{ itemIndex: i },
						);
					}

					if (task === 'transcribe' && responseFormat) {
						// A) Try raw from status endpoint
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
							// ignore
						}

						// C) If status JSON contains a URL to download result → fetch it
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
								// ignore
							}
						}
					}
				}

				const result: Record<string, any> = { task };

				if (task === 'summarize') {
					result.input_type = summarizeInput;
					if (summarizeInput === 'file') result.source_file = binaryData?.fileName;
					if (summarizeInput === 'text') result.source_text_chars = summarizeTextRaw.length;

					result.summary =
						typeof finalResponse === 'string'
							? finalResponse
							: finalResponse?.summary || finalResponse?.result || finalResponse?.text || finalResponse;
				} else if (task === 'transcribe') {
					result.source_file = binaryData?.fileName;
					if (model) result.model_used = model;
					if (responseFormat) result.response_format = responseFormat;

					if (responseFormat && typeof finalResponse === 'string') {
						result.subtitles = finalResponse.trim();
					} else {
						result.transcription =
							typeof finalResponse === 'string'
								? finalResponse.trim()
								: finalResponse?.text || finalResponse?.transcription || finalResponse?.data?.text || '';
					}
				} else if (task === 'diarize') {
					result.source_file = binaryData?.fileName;
					result.diarization = finalResponse;
				} else if (task === 'sentiment') {
					result.source_file = binaryData?.fileName;
					result.sentiment = finalResponse;
				}

				returnData.push({
					json: result,
					binary: items[i].binary,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
