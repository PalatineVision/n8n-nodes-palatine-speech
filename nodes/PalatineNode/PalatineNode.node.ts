import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	sleep,
} from 'n8n-workflow';

// Avoid restricted globals (globalThis) and external deps (form-data)
// Rely on Node 18+ built-in FormData/Blob. TS may not know these in some configs.
declare const FormData: any;
declare const Blob: any;

export class PalatineNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Palatine Speech',
		name: 'palatineNode',
		icon: {
			light: 'file:logo.svg',
			dark: 'file:logo2.svg',
		},
		group: ['transform'],
		version: 1,
		description: 'Transcribe, diarize, analyze sentiment or summarize audio using Palatine API',
		defaults: {
			name: 'Palatine Speech',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'palatineNodeApi', required: true }],
		properties: [
			{
				displayName: 'File',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				description: 'Input audio file for operations',
			},
			{
				displayName: 'Task',
				name: 'task',
				type: 'options',
				options: [
					{ name: 'Transcribe', value: 'transcribe', description: 'Speech to text' },
					{ name: 'Diarize', value: 'diarize', description: 'Audio tagging by speakers and timecodes' },
					{ name: 'Sentiment Analysis', value: 'sentiment', description: 'Determines emotional tone in audio' },
					{ name: 'Summarize', value: 'summarize', description: 'Provides summarization of audio files in various formats' },
				],
				default: 'transcribe',
				description: 'Choose: transcribe, diarize, analyze sentiment or summarize',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'palatine_small', value: 'palatine_small', description: 'Work faster' },
					{ name: 'palatine_large_turbo', value: 'palatine_large_turbo', description: 'More accurate model' },
				],
				default: 'palatine_small',
				description: 'Model (applies to all tasks)',
			},

			// ————— Summarize-only parameters —————
			{
				displayName: 'AI Task',
				name: 'summarizeTask',
				type: 'options',
				options: [
					{ name: 'Meeting Summary', value: 'meeting_summary', description: 'Automatic transcription of meeting, interview, or call' },
					{ name: 'User Prompt', value: 'user_prompt', description: 'A custom prompt for LLM model. For example, "Separately highlight new implementation ideas"' },
				],
				default: 'user_prompt',
				description: 'Summarization task',
				displayOptions: {
					show: {
						task: ['summarize'],
					},
				},
			},
			{
				displayName: 'Prompt',
				name: 'summarizePrompt',
				type: 'string',
				default: '',
				description: 'For example, "Structure conversation by topic". If empty, It will be transcription.',
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
				description: 'Enables advanced model reasoning mode',
				displayOptions: {
					show: {
						task: ['summarize'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const pollIntervalMs = 2000;
		const maxPollAttempts = 150;

		const extractTaskId = (resp: any): string | undefined => {
			if (!resp || typeof resp !== 'object') return undefined;
			return resp.task_id || resp.taskId || resp.id || resp.task?.id;
		};

		const normalizeStatus = (s: any): string => {
			if (typeof s !== 'string') return '';
			return s.trim().toLowerCase();
		};

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

		const unwrapFinalPayload = (statusPayload: any): any => {
			return (
				statusPayload?.result ??
				statusPayload?.data ??
				statusPayload?.output ??
				statusPayload?.response ??
				statusPayload
			);
		};

		const buildUrlWithQuery = (
			base: string,
			query: Record<string, string | boolean | undefined>,
		): string => {
			const params = new URLSearchParams();
			for (const [k, v] of Object.entries(query)) {
				if (v === undefined) continue;
				params.set(k, typeof v === 'boolean' ? String(v) : String(v));
			}
			const qs = params.toString();
			return qs ? `${base}?${qs}` : base;
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
				const task = this.getNodeParameter('task', i) as string;
				const model = this.getNodeParameter('model', i) as string;

				let summarizeTask: string | undefined;
				let summarizeThinking = false;
				let summarizePromptRaw = '';

				if (task === 'summarize') {
					summarizeTask = this.getNodeParameter('summarizeTask', i) as string;
					summarizeThinking = this.getNodeParameter('summarizeThinking', i) as boolean;

					if (summarizeTask === 'user_prompt') {
						summarizePromptRaw = this.getNodeParameter('summarizePrompt', i, { fallbackValue: '' }) as string;
					}
				}

				const binaryData = items[i].binary?.[binaryProperty];
				if (!binaryData) {
					throw new Error(`No binary data in property "${binaryProperty}"`);
				}

				const credentials = await this.getCredentials('palatineNodeApi');
				const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
				const apiKey = String(credentials.apiKey);

				const audioBuffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);

				let url: string;

				switch (task) {
					case 'transcribe':
						url = `${baseUrl}/api/v1/audio/transcriptions`;
						break;
					case 'diarize':
						url = `${baseUrl}/api/v1/diarization/do_diarize`;
						break;
					case 'sentiment':
						url = `${baseUrl}/api/v1/sentiment_analysis/analyze_file`;
						break;
					case 'summarize': {
						if (!summarizeTask) throw new Error('Summarize: summarizeTask is missing');

						const promptToSend =
							summarizeTask === 'meeting_summary'
								? '*'
								: (summarizePromptRaw || '').trim() || '*';

						const base = `${baseUrl}/api/v1/ai_service/summarize_file`;
						url = buildUrlWithQuery(base, {
							task: summarizeTask,
							prompt: promptToSend,
							thinking: summarizeThinking,
						});
						break;
					}
					default:
						throw new Error(`Unknown task: ${task}`);
				}

				// --- multipart via built-in FormData/Blob (no external deps, no globalThis) ---
				if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
					throw new Error(
						'FormData/Blob are not available in this runtime. Ensure Node.js 18+ / compatible n8n runtime.',
					);
				}

				const form = new FormData();
				const fileName = binaryData.fileName || 'audio';
				const mimeType = binaryData.mimeType || 'audio/mpeg';

				const fileBlob = new Blob([audioBuffer], { type: mimeType });
				form.append('file', fileBlob, fileName);
				form.append('model', model);

				const createResp = await this.helpers.httpRequest({
					method: 'POST',
					url,
					headers: {
						Authorization: `Bearer ${apiKey}`,
					},
					body: form as any,
					json: true,
				});

				let finalResponse: any = createResp;

				// 🔁 Poll for async tasks (non-transcribe)
				if (task !== 'transcribe') {
					const taskId = extractTaskId(createResp);

					if (taskId) {
						// NOTE: If Palatine uses different status endpoints per task, adjust here.
						const statusUrl = `${baseUrl}/api/v1/transcribe/task_status/${taskId}`;

						let statusPayload: any = null;
						let completed = false;

						for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
							statusPayload = await this.helpers.httpRequest({
								method: 'GET',
								url: statusUrl,
								headers: {
									Authorization: `Bearer ${apiKey}`,
								},
								json: true,
							});

							if (isTerminalFailure(statusPayload)) {
								throw new Error(
									`Task ${taskId} failed: ${
										statusPayload?.error || statusPayload?.message || JSON.stringify(statusPayload)
									}`,
								);
							}

							if (isTerminalSuccess(statusPayload)) {
								finalResponse = unwrapFinalPayload(statusPayload);
								completed = true;
								break;
							}

							// ✅ allowed alternative to setTimeout in community nodes
							await sleep(pollIntervalMs);
						}

						if (!completed) {
							throw new Error(
								`Task ${taskId} did not complete within polling limit (${maxPollAttempts} attempts)`,
							);
						}
					}
				}

				// 📤 Output
				const result: Record<string, any> = {
					task,
					source_file: binaryData.fileName,
					model_used: model,
				};

				if (task === 'transcribe') {
					result.transcription =
						typeof finalResponse === 'string'
							? finalResponse.trim()
							: (finalResponse?.text || finalResponse?.transcription || '');
				} else if (task === 'diarize') {
					result.diarization = finalResponse;
				} else if (task === 'sentiment') {
					result.sentiment = finalResponse;
				} else if (task === 'summarize') {
					result.summary =
						typeof finalResponse === 'string'
							? finalResponse
							: (finalResponse?.summary || finalResponse?.result || finalResponse?.text || finalResponse);
				}

				returnData.push({
					json: result,
					binary: items[i].binary,
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				if (this.continueOnFail()) {
					returnData.push({ json: { error: errorMessage } });
				} else {
					throw new Error(`[Palatine] ${errorMessage}`);
				}
			}
		}

		return [returnData];
	}
}
