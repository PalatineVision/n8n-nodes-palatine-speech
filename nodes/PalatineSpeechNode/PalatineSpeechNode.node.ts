import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type Task = 'transcribe' | 'diarize' | 'sentiment' | 'summarize';

// Polling defaults (by task)
const TASK_POLL_DEFAULTS: Record<Task, { pollIntervalMs: number; maxPollAttempts: number }> = {
	transcribe: { pollIntervalMs: 500, maxPollAttempts: 200 },
	diarize: { pollIntervalMs: 500, maxPollAttempts: 200 },
	sentiment: { pollIntervalMs: 500, maxPollAttempts: 200 },
	summarize: { pollIntervalMs: 20000, maxPollAttempts: 500 },
};

export class PalatineSpeechNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Palatine Speech',
		name: 'PalatineSpeechNode',
		icon: {
			light: 'file:logoLight.svg',
			dark: 'file:logoDark.svg',
		},
		group: ['transform'],
		version: 1,
		description:
			'Use Palatine Speech API to transcribe audio, diarize speakers, analyze sentiment, generate AI summaries and more',
		defaults: {
			name: 'Palatine Speech',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'PalatineSpeechNodeApi', required: true }],
		properties: [
			{
				displayName: 'File',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				description: 'Name of binary property that contains audio file',
			},
			{
				displayName: 'Task',
				name: 'task',
				type: 'options',
				options: [
					{ name: 'Transcribe', value: 'transcribe', description: 'Convert speech in audio file to text' },
					{
						name: 'Diarize',
						value: 'diarize',
						description: 'Split audio by speakers and return timestamps for each segment',
					},
					{
						name: 'Sentiment Analysis',
						value: 'sentiment',
						description: 'Detect sentiment/emotion in audio and return scores',
					},
					{
						name: 'Summarize',
						value: 'summarize',
						description: 'Generate an AI summary of audio (notes, decisions, action items)',
					},
				],
				default: 'transcribe',
				description: 'Select what to do with audio file',
			},
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
				displayOptions: {
					show: {
						task: ['transcribe'],
					},
				},
				default: 'palatine_small',
				description: 'Model used for transcription processing',
			},

			// ✅ Grouped options
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Polling Interval(ms)',
						name: 'pollIntervalMs',
						type: 'number',
						typeOptions: {
							minValue: 500,
							maxValue: 900000,
						},
						default: 500,
						description:
							'How often node polls API to retrieve result. Minimum 500 ms, maximum 900000 ms. (Summarize: if left unchanged, node uses 20000 ms by default)',
					},
					{
						displayName: 'Max Poll Attempts',
						name: 'maxPollAttempts',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 1000,
						},
						default: 200,
						description:
							'How many times node polls API before giving up. Minimum 1 attempt, maximum 1000 attempts. (Summarize: if left unchanged, node uses 500 by default)',
					},
				],
			},

			// Summarize-only
			{
				displayName: 'AI Task',
				name: 'summarizeTask',
				type: 'options',
				options: [
					{
						name: 'Meeting Summary',
						value: 'meeting_summary',
						description: 'Ready-made meeting summary: key points, decisions, and action items',
					},
					{
						name: 'User Prompt',
						value: 'user_prompt',
						description: 'Use your own prompt to control summary format/content',
					},
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
				description: 'Your instruction for AI. Used only with "User Prompt". Leave blank to use default prompt',
				displayOptions: {
					show: {
						task: ['summarize'],
						summarizeTask: ['user_prompt'],
					},
				},
			},
			{
				displayName: 'Thinking',
				name: 'summarizeThinking',
				type: 'boolean',
				default: false,
				description: 'Enable "thinking" mode for deeper reasoning (may increase processing time)',
				displayOptions: { show: { task: ['summarize'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('PalatineSpeechNodeApi');
		const baseUrl = String(credentials.baseUrl || '').replace(/\/$/, '');

		if (!baseUrl) {
			throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty');
		}

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

		const isTerminalSuccess = (statusPayload: any): boolean => {
			const s =
				normalizeStatus(statusPayload?.status) ||
				normalizeStatus(statusPayload?.state) ||
				normalizeStatus(statusPayload?.task_status);

			if (['completed', 'done', 'success', 'finished'].includes(s)) return true;

			const hasResult =
				statusPayload?.result !== undefined ||
				statusPayload?.data !== undefined ||
				statusPayload?.output !== undefined ||
				statusPayload?.response !== undefined;

			const looksProcessing = ['queued', 'pending', 'processing', 'running', 'in_progress'].includes(s);

			return hasResult && !looksProcessing;
		};

		const isTerminalFailure = (statusPayload: any): boolean => {
			const s =
				normalizeStatus(statusPayload?.status) ||
				normalizeStatus(statusPayload?.state) ||
				normalizeStatus(statusPayload?.task_status);

			return ['failed', 'error', 'canceled', 'cancelled'].includes(s);
		};

		const unwrapFinalPayload = (statusPayload: any): any =>
			statusPayload?.result ??
			statusPayload?.data ??
			statusPayload?.output ??
			statusPayload?.response ??
			statusPayload;

		for (let i = 0; i < items.length; i++) {
			try {
				const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
				const task = this.getNodeParameter('task', i) as Task;

				let model: string | undefined;
				if (task === 'transcribe') {
					model = this.getNodeParameter('model', i) as string;
				}

				const binaryData = items[i].binary?.[binaryProperty];
				if (!binaryData) {
					throw new NodeOperationError(this.getNode(), `No binary data in property "${binaryProperty}"`, {
						itemIndex: i,
					});
				}

				let summarizeTask: string | undefined;
				let summarizeThinking = false;
				let summarizePromptRaw = '';

				if (task === 'summarize') {
					summarizeTask = this.getNodeParameter('summarizeTask', i) as string;
					summarizeThinking = this.getNodeParameter('summarizeThinking', i) as boolean;
					if (summarizeTask === 'user_prompt') {
						summarizePromptRaw = (this.getNodeParameter('summarizePrompt', i, '') as string) || '';
					}
				}

				// ✅ Polling params from UI (Options collection) + backward compat with old top-level params
				const uiOptions = (this.getNodeParameter('options', i, {}) as {
					pollIntervalMs?: number;
					maxPollAttempts?: number;
				}) ?? {};

				// old saved workflows may still have these at top-level in node.parameters
				const legacyParams = (this.getNode().parameters || {}) as {
					pollIntervalMs?: number;
					maxPollAttempts?: number;
				};

				let pollIntervalMs = (uiOptions.pollIntervalMs ?? legacyParams.pollIntervalMs ?? 500) as number;
				let maxPollAttempts = (uiOptions.maxPollAttempts ?? legacyParams.maxPollAttempts ?? 200) as number;

				// Task-specific defaults (also supports old saved defaults 1000/300)
				const taskDefaults = TASK_POLL_DEFAULTS[task];

				if (task === 'summarize') {
					// if user left UI default (500/200) OR old defaults (1000/300) → use summarize defaults
					if (pollIntervalMs === 500 || pollIntervalMs === 1000) pollIntervalMs = taskDefaults.pollIntervalMs; // 20000
					if (maxPollAttempts === 200 || maxPollAttempts === 300) maxPollAttempts = taskDefaults.maxPollAttempts; // 500
				} else {
					// if old flows have 1000/300 → switch to new non-summarize defaults
					if (pollIntervalMs === 1000) pollIntervalMs = taskDefaults.pollIntervalMs; // 500
					if (maxPollAttempts === 300) maxPollAttempts = taskDefaults.maxPollAttempts; // 200
				}

				// clamp
				pollIntervalMs = Math.min(900000, Math.max(500, pollIntervalMs));
				maxPollAttempts = Math.min(1000, Math.max(1, maxPollAttempts));

				const audioBuffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);

				// Endpoints (polling API)
				let url: string;
				let qs: Record<string, string | boolean> | undefined;

				switch (task) {
					case 'transcribe':
						url = `${baseUrl}/api/v1/transcribe/do_transcribe`;
						break;
					case 'diarize':
						url = `${baseUrl}/api/v1/diarization/do_diarize`;
						break;
					case 'sentiment':
						url = `${baseUrl}/api/v1/sentiment_analysis/analyze_file`;
						break;
					case 'summarize': {
						if (!summarizeTask) {
							throw new NodeOperationError(this.getNode(), 'Summarize: summarizeTask is missing', {
								itemIndex: i,
							});
						}

						const promptToSend =
							summarizeTask === 'meeting_summary' ? '*' : (summarizePromptRaw || '').trim() || '*';

						url = `${baseUrl}/api/v1/ai_service/summarize_file`;
						qs = {
							task: summarizeTask,
							prompt: promptToSend,
							thinking: summarizeThinking,
						};
						break;
					}
					default:
						throw new NodeOperationError(this.getNode(), `Unknown task: ${task}`, { itemIndex: i });
				}

				// Multipart via built-in FormData/Blob (Node 18+)
				const form = new FormData();
				const fileName = binaryData.fileName || 'audio';
				const mimeType = binaryData.mimeType || 'audio/mpeg';

				const u8 = new Uint8Array(audioBuffer);
				form.append('file', new Blob([u8], { type: mimeType }), fileName);

				if (model) {
					form.append('model', model);
				}

				const createOptions: IHttpRequestOptions = {
					method: 'POST',
					url,
					qs,
					body: form,
					json: true,
				};

				const createResp = await request(createOptions, i);

				let finalResponse: any = createResp;
				const taskId = extractTaskId(createResp);

				// If API responded with task_id → poll unified status endpoint
				if (taskId) {
					const statusUrl = `${baseUrl}/api/v1/transcribe/task_status/${taskId}`;

					let statusPayload: any = null;
					let completed = false;

					for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
						statusPayload = await request(
							{
								method: 'GET',
								url: statusUrl,
								json: true,
							},
							i,
						);

						if (isTerminalFailure(statusPayload)) {
							throw new NodeOperationError(
								this.getNode(),
								`Task ${taskId} failed: ${
									statusPayload?.error || statusPayload?.message || JSON.stringify(statusPayload)
								}`,
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
				}

				// Output
				const result: Record<string, any> = {
					task,
					source_file: binaryData.fileName,
				};

				if (task === 'transcribe' && model) {
					result.model_used = model;
				}

				if (task === 'transcribe') {
					result.transcription =
						typeof finalResponse === 'string'
							? finalResponse.trim()
							: finalResponse?.text || finalResponse?.transcription || finalResponse?.data?.text || '';
				} else if (task === 'diarize') {
					result.diarization = finalResponse;
				} else if (task === 'sentiment') {
					result.sentiment = finalResponse;
				} else if (task === 'summarize') {
					result.summary =
						typeof finalResponse === 'string'
							? finalResponse
							: finalResponse?.summary || finalResponse?.result || finalResponse?.text || finalResponse;
				}

				returnData.push({
					json: result,
					binary: items[i].binary,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({
						json: { error: message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
