import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type Task = 'transcribe' | 'diarize' | 'sentiment' | 'summarize';

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
				description: 'Choose task',
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

			// Summarize-only
			{
				displayName: 'AI Task',
				name: 'summarizeTask',
				type: 'options',
				options: [
					{ name: 'Meeting Summary', value: 'meeting_summary', description: 'Automatic meeting/interview/call summary' },
					{ name: 'User Prompt', value: 'user_prompt', description: 'Custom prompt for the LLM' },
				],
				default: 'user_prompt',
				description: 'Summarization task',
				displayOptions: { show: { task: ['summarize'] } },
			},
			{
				displayName: 'Prompt',
				name: 'summarizePrompt',
				type: 'string',
				default: '',
				description: 'For example, "Structure conversation by topic". If empty, it will be transcription.',
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
				displayOptions: { show: { task: ['summarize'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Polling
		const pollIntervalMs = 2000;
		const maxPollAttempts = 150;

		const credentials = await this.getCredentials('palatineNodeApi');
		const baseUrl = String(credentials.baseUrl || '').replace(/\/$/, '');

		if (!baseUrl) {
			throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty');
		}

		const request = async (options: IHttpRequestOptions, itemIndex: number) => {
			try {
				return await this.helpers.httpRequestWithAuthentication.call(
					this,
					'palatineNodeApi',
					options,
				);
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
				const model = this.getNodeParameter('model', i) as string;

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
							summarizeTask === 'meeting_summary'
								? '*'
								: (summarizePromptRaw || '').trim() || '*';

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

				const u8 = new Uint8Array(audioBuffer); // создаёт копию и гарантирует ArrayBuffer под капотом
                form.append('file', new Blob([u8], { type: mimeType }), fileName);
				form.append('model', model);

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
					model_used: model,
				};

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

				// If it's already a NodeOperationError/NodeApiError — rethrow
				throw error;
			}
		}

		return [returnData];
	}
}
