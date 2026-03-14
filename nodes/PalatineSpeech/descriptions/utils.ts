import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type AnyRecord = Record<string, unknown>;

type TaskKind = 'transcribe' | 'diarize' | 'sentiment' | 'summarize';

type PollDefaults = { pollIntervalMs: number; maxPollAttempts: number };
const TASK_POLL_DEFAULTS: Record<TaskKind, PollDefaults> = {
	transcribe: { pollIntervalMs: 500, maxPollAttempts: 200 },
	diarize: { pollIntervalMs: 500, maxPollAttempts: 200 },
	sentiment: { pollIntervalMs: 500, maxPollAttempts: 200 },
	summarize: { pollIntervalMs: 20000, maxPollAttempts: 500 },
};

export function toJsonError(error: unknown): JsonObject {
	if (error instanceof Error) {
		const json: JsonObject = { name: error.name, message: error.message };
		if (typeof error.stack === 'string') json.stack = error.stack;
		return json;
	}
	if (typeof error === 'string') return { message: error };
	if (typeof error === 'object' && error !== null) return error as JsonObject;
	return { message: 'Unknown error' };
}

function isObject(value: unknown): value is AnyRecord {
	return typeof value === 'object' && value !== null;
}

function normalizeStatus(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
	return /^\s*WEBVTT\b/.test(text) || /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(text);
}

function findFirstUrl(obj: unknown): string | undefined {
	if (!isObject(obj)) return undefined;

	const seen = new Set<AnyRecord>();
	const stack: AnyRecord[] = [obj];

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

async function getBaseUrlFromCreds(this: IExecuteSingleFunctions): Promise<string> {
	const creds = (await this.getCredentials('palatineSpeechNodeApi')) as unknown as AnyRecord;
	const raw = String(creds?.baseUrl ?? '').trim();
	return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function statusPathForOperation(operation: string, taskId: string): string {
	switch (operation) {
		case 'transcribe':
			return `/api/v1/transcribe/task_status/${taskId}`;
		case 'diarize':
			return `/api/v1/diarization/task_status/${taskId}`;
		case 'sentiment':
			return `/api/v1/sentiment_analysis/task_status/${taskId}`;
		case 'summarizeFile':
		case 'summarizeText':
			return `/api/v1/ai_service/task_status/${taskId}`;
		default:
			return `/api/v1/ai_service/task_status/${taskId}`;
	}
}

function taskKindForOperation(operation: string): TaskKind {
	switch (operation) {
		case 'transcribe':
			return 'transcribe';
		case 'diarize':
			return 'diarize';
		case 'sentiment':
			return 'sentiment';
		case 'summarizeFile':
		case 'summarizeText':
			return 'summarize';
		default:
			return 'summarize';
	}
}

function getPollingConfig(this: IExecuteSingleFunctions, taskKind: TaskKind): PollDefaults {
	const polling = (this.getNodeParameter('polling', {}) as IDataObject) ?? {};
	let pollIntervalMs = Number(polling.pollIntervalMs ?? 500);
	let maxPollAttempts = Number(polling.maxPollAttempts ?? 200);

	const defaults = TASK_POLL_DEFAULTS[taskKind];

	if (taskKind === 'summarize') {
		if (pollIntervalMs === 500 || pollIntervalMs === 1000) pollIntervalMs = defaults.pollIntervalMs;
		if (maxPollAttempts === 200 || maxPollAttempts === 300) maxPollAttempts = defaults.maxPollAttempts;
	} else {
		if (pollIntervalMs === 1000) pollIntervalMs = defaults.pollIntervalMs;
		if (maxPollAttempts === 300) maxPollAttempts = defaults.maxPollAttempts;
	}

	pollIntervalMs = Math.min(900000, Math.max(500, pollIntervalMs));
	maxPollAttempts = Math.min(1000, Math.max(1, maxPollAttempts));

	return { pollIntervalMs, maxPollAttempts };
}

async function authedRequest(this: IExecuteSingleFunctions, options: IHttpRequestOptions): Promise<unknown> {
	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'palatineSpeechNodeApi', options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), toJsonError(error));
	}
}

async function pollTask(
	this: IExecuteSingleFunctions,
	operation: string,
	taskId: string,
	responseFormat?: string,
): Promise<{ finalResponse: unknown; statusPayload: unknown }> {
	const baseUrl = await getBaseUrlFromCreds.call(this);
	if (!baseUrl) throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty.');

	const taskKind = taskKindForOperation(operation);
	const { pollIntervalMs, maxPollAttempts } = getPollingConfig.call(this, taskKind);

	const statusUrl = `${baseUrl}${statusPathForOperation(operation, taskId)}`;

	let statusPayload: unknown = null;

	for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
		statusPayload = await authedRequest.call(this, { method: 'GET', url: statusUrl, json: true });

		if (isTerminalFailure(statusPayload)) throw new NodeOperationError(this.getNode(), `Task ${taskId} failed.`);

		if (isTerminalSuccess(statusPayload)) {
			let finalResponse: unknown = unwrapFinalPayload(statusPayload);

			if (operation === 'transcribe' && responseFormat) {
				try {
					const raw = await authedRequest.call(this, {
						method: 'GET',
						url: statusUrl,
						qs: { response_format: responseFormat },
						json: false,
					} as IHttpRequestOptions);

					if (typeof raw === 'string') {
						const t = raw.trim();
						if ((responseFormat === 'srt' && looksLikeSrt(t)) || (responseFormat === 'vtt' && looksLikeVtt(t))) {
							finalResponse = t;
						}
					}
				} catch {
					// ignore
				}

				const downloadUrl = findFirstUrl(statusPayload);
				if (downloadUrl) {
					try {
						const downloaded = await authedRequest.call(this, {
							method: 'GET',
							url: downloadUrl,
							qs: { response_format: responseFormat },
							json: false,
						} as IHttpRequestOptions);

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

			return { finalResponse, statusPayload };
		}

		await sleep(pollIntervalMs);
	}

	throw new NodeOperationError(
		this.getNode(),
		`Task ${taskId} did not complete within polling limit (${maxPollAttempts} attempts).`,
	);
}

function safeStringify(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value === null || value === undefined) return '';
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function parseMaybeJson(body: unknown): unknown {
	if (Buffer.isBuffer(body)) return body.toString('utf8');

	if (typeof body === 'string') {
		const t = body.trim();
		if (!t) return '';
		if (t.startsWith('{') || t.startsWith('[')) {
			try {
				return JSON.parse(t);
			} catch {
				return t;
			}
		}
		return t;
	}

	return body;
}

// -----------------------------
// Speech/AI postReceive (polling)
// -----------------------------
export async function postReceivePalatine(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	responseData: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const operation = String(this.getNodeParameter('operation'));
	const responseFormat = operation === 'transcribe' ? String(this.getNodeParameter('responseFormat', '')) : '';

	const createResp: unknown = parseMaybeJson(responseData.body);

	const taskId = extractTaskId(createResp);
	let finalResponse: unknown = createResp;

	if (taskId) {
		const polled = await pollTask.call(this, operation, taskId, responseFormat || undefined);
		finalResponse = polled.finalResponse;
	}

	return items.map((item) => {
		const result: IDataObject = {};

		const binaryProperty =
			operation === 'summarizeText' ? '' : String(this.getNodeParameter('binaryProperty', 'data'));
		const sourceFile = binaryProperty ? item.binary?.[binaryProperty]?.fileName ?? '' : '';

		if (operation === 'transcribe') {
			result.task = 'transcribe';
			result.source_file = sourceFile;

			const model = String(this.getNodeParameter('model', '') || '');
			if (model) result.model_used = model;
			if (responseFormat) result.response_format = responseFormat;

			if (responseFormat && typeof finalResponse === 'string') {
				result.subtitles = finalResponse.trim();
			} else if (typeof finalResponse === 'string') {
				result.transcription = finalResponse.trim();
			} else if (isObject(finalResponse)) {
				const t = (finalResponse as AnyRecord).text ?? (finalResponse as AnyRecord).transcription;
				result.transcription = typeof t === 'string' ? t : safeStringify(finalResponse);
			} else {
				result.transcription = safeStringify(finalResponse);
			}
		} else if (operation === 'diarize') {
			result.task = 'diarize';
			result.source_file = sourceFile;
			result.diarization = isObject(finalResponse) ? (finalResponse as IDataObject) : safeStringify(finalResponse);
		} else if (operation === 'sentiment') {
			result.task = 'sentiment';
			result.source_file = sourceFile;
			result.sentiment = isObject(finalResponse) ? (finalResponse as IDataObject) : safeStringify(finalResponse);
		} else if (operation === 'summarizeFile' || operation === 'summarizeText') {
			result.task = 'summarize';
			result.input_type = operation === 'summarizeText' ? 'text' : 'file';

			if (operation === 'summarizeFile') result.source_file = sourceFile;
			if (operation === 'summarizeText') {
				const text = String(this.getNodeParameter('text', '') || '');
				result.source_text_chars = text.length;
			}

			if (typeof finalResponse === 'string') result.summary = finalResponse;
			else if (isObject(finalResponse)) result.summary = finalResponse as IDataObject;
			else result.summary = safeStringify(finalResponse);
		} else {
			result.task = operation;
			result.result = isObject(finalResponse) ? (finalResponse as IDataObject) : safeStringify(finalResponse);
		}

		return { json: result, binary: item.binary };
	});
}

// -----------------------------
// multipart preSend helpers
// -----------------------------
export async function preSendFile(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
	extra?: (formData: FormData) => void,
): Promise<IHttpRequestOptions> {
	const binaryProperty = this.getNodeParameter('binaryProperty', 'data') as string;

	const item = this.getInputData() as unknown as INodeExecutionData;
	const binary = item?.binary?.[binaryProperty];
	const fileName = String(binary?.fileName || 'audio');
	const mimeType = String(binary?.mimeType || 'application/octet-stream');

	const fileBuffer = await this.helpers.getBinaryDataBuffer(binaryProperty);
	const u8 = Uint8Array.from(fileBuffer);

	const formData = new FormData();
	formData.append('file', new Blob([u8], { type: mimeType }), fileName);

	if (extra) extra(formData);

	requestOptions.body = formData;
	return requestOptions;
}

export async function preSendTranscribe(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	return await preSendFile.call(this, requestOptions, (formData) => {
		const model = String(this.getNodeParameter('model', '') || '');
		const responseFormat = String(this.getNodeParameter('responseFormat', '') || '');

		if (model) formData.append('model', model);
		if (responseFormat) formData.append('response_format', responseFormat);
	});
}

export async function preSendSummarizeText(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const text = String(this.getNodeParameter('text', '') || '').trim();
	if (!text) throw new NodeOperationError(this.getNode(), 'Summarize (Text): "Text" is empty.');

	requestOptions.body = text;
	return requestOptions;
}

// -----------------------------
// LLM Chat Completions
// -----------------------------
export async function preSendChatCompletions(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const model = String(this.getNodeParameter('llmModel', '') || '').trim();
	if (!model) throw new NodeOperationError(this.getNode(), 'LLM: "Model" is empty.');

	const systemPrompt = String(this.getNodeParameter('systemPrompt', '') || '').trim();
	const userMessage = String(this.getNodeParameter('userMessage', '') || '').trim();
	if (!userMessage) throw new NodeOperationError(this.getNode(), 'LLM: "User Message" is empty.');

	const historyRaw = (this.getNodeParameter('history', {}) as IDataObject) ?? {};
	const historyMessages =
		(historyRaw.message as Array<{ role?: string; content?: string }> | undefined) ?? [];

	const messages: Array<{ role: string; content: string }> = [];

	if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

	for (const m of historyMessages) {
		const role = String(m.role || '').trim();
		const content = String(m.content || '').trim();
		if (!role || !content) continue;
		messages.push({ role, content });
	}

	messages.push({ role: 'user', content: userMessage });

	const opts = (this.getNodeParameter('llmOptions', {}) as IDataObject) ?? {};

	const temperature = opts.temperature !== undefined ? Number(opts.temperature) : undefined;
	const maxTokens = opts.maxTokens !== undefined ? Number(opts.maxTokens) : undefined;
	const thinking = opts.thinking !== undefined ? Boolean(opts.thinking) : undefined;

	const responseFormatMode = String(opts.responseFormatMode || 'none');
	const responseFormatJsonRaw = typeof opts.responseFormatJson === 'string' ? opts.responseFormatJson : '';
	const formatRaw = typeof opts.format === 'string' ? opts.format : '';

	const payload: AnyRecord = {
		model,
		messages,
	};

	if (Number.isFinite(temperature)) payload.temperature = temperature;
	if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens;
	if (thinking !== undefined) payload.thinking = thinking;

	if (responseFormatMode === 'json_object') {
		payload.response_format = { type: 'json_object' };
	} else if (responseFormatMode === 'custom') {
		try {
			const rf = JSON.parse(String(responseFormatJsonRaw || '{}'));
			if (rf && typeof rf === 'object') payload.response_format = rf as AnyRecord;
		} catch {
			throw new NodeOperationError(this.getNode(), 'LLM: "Response Format (JSON)" is not valid JSON.');
		}
	}

	try {
		const fmt = JSON.parse(String(formatRaw || '{}'));
		if (fmt && typeof fmt === 'object' && Object.keys(fmt as AnyRecord).length) payload.format = fmt as AnyRecord;
	} catch {
		throw new NodeOperationError(this.getNode(), 'LLM: "Format (Ollama JSON)" is not valid JSON.');
	}

	requestOptions.body = payload;
	requestOptions.json = true;

	return requestOptions;
}

export async function postReceiveLlmChat(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	responseData: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = parseMaybeJson(responseData.body);

	return items.map((item) => {
		const out: IDataObject = {
			id: '',
			model: '',
			created: 0,
			text: '',
			choices: [],
			usage: {},
			raw: body as IDataObject,
		};

		if (isObject(body)) {
			out.id = typeof body.id === 'string' ? body.id : '';
			out.model = typeof body.model === 'string' ? body.model : '';
			out.created = typeof body.created === 'number' ? body.created : 0;
			out.choices = Array.isArray(body.choices) ? (body.choices as unknown as IDataObject[]) : [];
			out.usage = isObject(body.usage) ? (body.usage as IDataObject) : {};

			const first = Array.isArray(body.choices) ? body.choices[0] : undefined;
			const msg = isObject(first) ? (first as AnyRecord).message : undefined;
			const content = isObject(msg) ? (msg as AnyRecord).content : undefined;
			out.text = typeof content === 'string' ? content : '';
		}

		return { json: out, binary: item.binary };
	});
}

export async function postReceiveLlmModels(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	responseData: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = parseMaybeJson(responseData.body);

	return items.map((item) => {
		const out: IDataObject = {
			object: '',
			data: [],
			modelIds: [],
			raw: body as IDataObject,
		};

		if (isObject(body)) {
			out.object = typeof body.object === 'string' ? body.object : '';

			const data = Array.isArray(body.data) ? body.data : [];
			out.data = data as unknown as IDataObject[];

			const modelIds = data
				.map((m): string | null => {
					if (!isObject(m)) return null;
					const id = (m as AnyRecord).id;
					return typeof id === 'string' ? id : null;
				})
				.filter((x): x is string => typeof x === 'string');

			out.modelIds = modelIds;
		}

		return { json: out, binary: item.binary };
	});
}