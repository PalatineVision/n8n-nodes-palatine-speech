import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { getPollingConfig } from './polling';
import type { TaskKind } from './polling';

type AnyRecord = Record<string, unknown>;

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

function isPlainObject(value: unknown): value is AnyRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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
	return (
		/^\s*WEBVTT\b/.test(text) ||
		/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(text)
	);
}

function toText(value: unknown): string | undefined {
	if (typeof value === 'string') return value;

	if (Buffer.isBuffer(value)) return value.toString('utf8');

	if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');

	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer).toString('utf8');

	return undefined;
}

function parseMaybeJson(body: unknown): unknown {
	const maybeText = toText(body);
	if (maybeText !== undefined) {
		const t = maybeText.trim();
		if (!t) return '';
		if (t.startsWith('{') || t.startsWith('[')) {
			try {
				return JSON.parse(t);
			} catch {
				return maybeText;
			}
		}
		return maybeText;
	}

	return body;
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

async function authedRequest(
	this: IExecuteSingleFunctions,
	options: IHttpRequestOptions,
	// Lets the caller throw a more specific error (timeout, cancellation) instead of the HTTP error.
	beforeWrapError?: () => void,
): Promise<unknown> {
	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'palatineSpeechNodeApi', options);
	} catch (error) {
		beforeWrapError?.();
		throw new NodeApiError(this.getNode(), toJsonError(error));
	}
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

// -----------------------------
// Diarize: SRT/VTT fallback builder
// -----------------------------
type DiarizeSegment = {
	start?: number;
	end?: number;
	speaker?: string;
	segment_id?: number;
	text?: string;
};

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function pad3(n: number): string {
	return String(n).padStart(3, '0');
}

function formatTimeSrt(seconds: number): string {
	const msTotal = Math.max(0, Math.round(seconds * 1000));
	const ms = msTotal % 1000;
	const totalSec = (msTotal - ms) / 1000;
	const s = totalSec % 60;
	const totalMin = (totalSec - s) / 60;
	const m = totalMin % 60;
	const h = (totalMin - m) / 60;
	return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function formatTimeVtt(seconds: number): string {
	const msTotal = Math.max(0, Math.round(seconds * 1000));
	const ms = msTotal % 1000;
	const totalSec = (msTotal - ms) / 1000;
	const s = totalSec % 60;
	const totalMin = (totalSec - s) / 60;
	const m = totalMin % 60;
	const h = (totalMin - m) / 60;
	return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

function buildSubtitlesFromSegments(segments: DiarizeSegment[], fmt: 'srt' | 'vtt'): string {
	const lines: string[] = [];

	if (fmt === 'vtt') {
		lines.push('WEBVTT', '');
	}

	let idx = 1;
	for (const seg of segments) {
		const start = typeof seg.start === 'number' ? seg.start : 0;
		const end = typeof seg.end === 'number' ? seg.end : start;

		const speaker = typeof seg.speaker === 'string' && seg.speaker.trim() ? seg.speaker.trim() : 'SPEAKER';
		const content = typeof seg.text === 'string' && seg.text.trim() ? seg.text.trim() : speaker;

		const from = fmt === 'srt' ? formatTimeSrt(start) : formatTimeVtt(start);
		const to = fmt === 'srt' ? formatTimeSrt(end) : formatTimeVtt(end);

		lines.push(String(idx));
		lines.push(`${from} --> ${to}`);
		lines.push(content);
		lines.push('');
		idx++;
	}

	return lines.join('\n').trimEnd();
}

// -----------------------------
// Polling
// -----------------------------
async function pollTask(
	this: IExecuteSingleFunctions,
	operation: string,
	taskId: string,
	responseFormatForDiarize?: string,
): Promise<{ finalResponse: unknown; statusPayload: unknown }> {
	const baseUrl = await getBaseUrlFromCreds.call(this);
	if (!baseUrl) throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty.');

	const taskKind = taskKindForOperation(operation);
	const { pollIntervalMs, maxPollAttempts, maxWaitMs } = getPollingConfig.call(this, taskKind);
	const deadline = Date.now() + maxWaitMs;
	const signal = this.getExecutionCancelSignal?.();
	const checkCancellation = () => {
		if (signal?.aborted) throw new NodeOperationError(this.getNode(), `Waiting for task ${taskId} was cancelled.`);
	};
	const timeoutError = () => new NodeOperationError(
		this.getNode(),
		`Task ${taskId} did not complete within the maximum wait time (${maxWaitMs / 1000} seconds).`,
		{ description: 'The API task may still be running. Increase Polling Options > Max Wait Time (Seconds) for future executions.' },
	);
	const requestBeforeDeadline = async (options: IHttpRequestOptions): Promise<unknown> => {
		checkCancellation();
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0) throw timeoutError();
		const checkStillWaiting = () => {
			checkCancellation();
			if (Date.now() >= deadline) throw timeoutError();
		};
		const target = new URL(options.url);
		if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
			throw new NodeOperationError(this.getNode(), 'Invalid task result URL.');
		}
		const sameOrigin = target.origin === new URL(baseUrl).origin;
		const requestOptions = {
			...options,
			timeout: Math.min(300000, remainingMs),
			abortSignal: signal,
			// Never forward credentials through an API redirect to another origin.
			disableFollowRedirect: true,
		};
		let result: unknown;
		if (sameOrigin) {
			result = await authedRequest.call(this, requestOptions, checkStillWaiting);
		} else {
			try {
				result = await this.helpers.httpRequest(requestOptions);
			} catch (error) {
				checkStillWaiting();
				throw new NodeApiError(this.getNode(), toJsonError(error));
			}
		}
		checkStillWaiting();
		return result;
	};

	const statusUrl = `${baseUrl}${statusPathForOperation(operation, taskId)}`;

	let statusPayload: unknown = null;

	for (let attempt = 1; maxPollAttempts === 0 || attempt <= maxPollAttempts; attempt++) {
		statusPayload = await requestBeforeDeadline({ method: 'GET', url: statusUrl, json: true });

		if (isTerminalFailure(statusPayload)) {
			throw new NodeOperationError(this.getNode(), `Task ${taskId} failed.`);
		}

		if (isTerminalSuccess(statusPayload)) {
			let finalResponse: unknown = unwrapFinalPayload(statusPayload);

			// response_format ONLY for diarize (not transcribe)
			if (operation === 'diarize' && responseFormatForDiarize && responseFormatForDiarize !== 'json') {
				// 1) try statusUrl with qs
				try {
					const raw = await requestBeforeDeadline({
						method: 'GET',
						url: statusUrl,
						qs: { response_format: responseFormatForDiarize },
						json: false,
					} as IHttpRequestOptions);

					const rawText = toText(raw);
					if (rawText !== undefined) {
						const t = rawText.trim();
						if (
							(responseFormatForDiarize === 'srt' && looksLikeSrt(t)) ||
							(responseFormatForDiarize === 'vtt' && looksLikeVtt(t))
						) {
							finalResponse = t;
						}
					}
				} catch {
					// ignore
				}

				// 2) try download url from payload
				const downloadUrl = findFirstUrl(statusPayload);
				if (downloadUrl) {
					try {
						const downloaded = await requestBeforeDeadline({
							method: 'GET',
							url: downloadUrl,
							qs: { response_format: responseFormatForDiarize },
							json: false,
						} as IHttpRequestOptions);

						const downloadedText = toText(downloaded);
						if (downloadedText !== undefined) {
							const t = downloadedText.trim();
							if (
								(responseFormatForDiarize === 'srt' && looksLikeSrt(t)) ||
								(responseFormatForDiarize === 'vtt' && looksLikeVtt(t))
							) {
								finalResponse = t;
							}
						}
					} catch {
						// ignore
					}
				}
			}

			checkCancellation();
			if (Date.now() >= deadline) throw timeoutError();
			return { finalResponse, statusPayload };
		}

		if (maxPollAttempts > 0 && attempt === maxPollAttempts) break;
		const wakeAt = Math.min(deadline, Date.now() + pollIntervalMs);
		while (Date.now() < wakeAt) {
			checkCancellation();
			// Check cancellation during long intervals without accumulating abort listeners.
			await sleep(Math.min(1000, wakeAt - Date.now()));
		}
	}

	throw new NodeOperationError(
		this.getNode(),
		`Task ${taskId} did not complete within polling limit (${maxPollAttempts} attempts).`,
		{ description: 'The API task may still be running. Increase Max Poll Attempts or set it to 0 to use only the maximum wait time.' },
	);
}

// -----------------------------
// Speech + AI postReceive (includes summarizeFile/summarizeText)
// -----------------------------
export async function postReceivePalatine(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	responseData: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const resource = String(this.getNodeParameter('resource', '') || '');
	const operationFromResource =
		resource === 'transcription'
			? 'transcribe'
			: resource === 'diarize'
				? 'diarize'
				: resource === 'sentiment'
					? 'sentiment'
					: '';
	const operation =
		operationFromResource || String(this.getNodeParameter('operation', '') || '');

	const diarizeResponseFormat =
		operation === 'diarize'
			? String(this.getNodeParameter('responseFormat', 'json') || 'json')
			: undefined;

	const createResp: unknown = parseMaybeJson(responseData.body);
	const taskId = extractTaskId(createResp);

	let finalResponse: unknown = createResp;

	if (taskId) {
		const polled = await pollTask.call(this, operation, taskId, diarizeResponseFormat);
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

			if (typeof finalResponse === 'string') {
				result.transcription = finalResponse.trim();
			} else if (isObject(finalResponse)) {
				const t = finalResponse.text ?? finalResponse.transcription;
				result.transcription = typeof t === 'string' ? t : safeStringify(finalResponse);
			} else {
				result.transcription = safeStringify(finalResponse);
			}
		} else if (operation === 'diarize') {
			result.task = 'diarize';
			result.source_file = sourceFile;
			result.response_format = diarizeResponseFormat ?? 'json';

			if (diarizeResponseFormat && diarizeResponseFormat !== 'json') {
				if (typeof finalResponse === 'string') {
					result.subtitles = finalResponse.trim();
				} else if (isObject(finalResponse)) {
					const segmentsRaw = finalResponse.segments;
					const segments = Array.isArray(segmentsRaw) ? (segmentsRaw as unknown as DiarizeSegment[]) : [];
					const fmt = diarizeResponseFormat === 'vtt' ? 'vtt' : 'srt';
					result.subtitles = buildSubtitlesFromSegments(segments, fmt);
				} else {
					result.subtitles = safeStringify(finalResponse);
				}
			} else {
				result.diarization = isObject(finalResponse) ? (finalResponse as IDataObject) : safeStringify(finalResponse);
			}
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
	// Validate before creating a remote task, so invalid options do not leave an orphaned job.
	getPollingConfig.call(this, taskKindForOperation(String(this.getNodeParameter('operation', ''))));
	const binaryProperty = this.getNodeParameter('binaryProperty', 'data') as string;

	const item = this.getInputData();
	const binary = item?.binary?.[binaryProperty];

	const fileName = String(binary?.fileName || 'audio');
	const mimeType = String(binary?.mimeType || 'application/octet-stream');

	// this signature worked in your project; keep it
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
	// response_format removed from transcribe
	return await preSendFile.call(this, requestOptions, (formData) => {
		const model = String(this.getNodeParameter('model', '') || '');
		if (model) formData.append('model', model);
	});
}

export async function preSendSummarizeText(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	getPollingConfig.call(this, 'summarize');
	const text = String(this.getNodeParameter('text', '') || '').trim();
	if (!text) throw new NodeOperationError(this.getNode(), 'Summarize (Text): "Text" is empty.');

	requestOptions.body = text;
	return requestOptions;
}

// -----------------------------
// LLM helpers: json_schema parsing + minimal validation
// -----------------------------
function stripCodeFences(input: string): string {
	const t = input.trim();
	if (t.startsWith('```')) {
		const firstNewline = t.indexOf('\n');
		const lastFence = t.lastIndexOf('```');
		if (firstNewline !== -1 && lastFence !== -1 && lastFence > firstNewline) {
			return t.slice(firstNewline + 1, lastFence).trim();
		}
	}
	return t;
}

function tryParseJsonFromContent(content: string): { ok: boolean; value: unknown; error?: string } {
	const cleaned = stripCodeFences(content);
	try {
		return { ok: true, value: JSON.parse(cleaned) };
	} catch (e) {
		return { ok: false, value: null, error: e instanceof Error ? e.message : String(e) };
	}
}

function checkSchemaSupport(schema: unknown, path: string, errors: string[], depth = 0): void {
	if (depth > 12) {
		errors.push(`${path}: schema nesting exceeds the supported depth (12)`);
		return;
	}
	if (!isPlainObject(schema)) {
		errors.push(`${path}: only object schemas are supported locally`);
		return;
	}
	const supported = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'title', 'description', 'default', 'examples', '$comment'];
	for (const key of Object.keys(schema)) {
		if (!supported.includes(key)) errors.push(`${path}: unsupported schema keyword "${key}"; local validation is incomplete`);
	}
	if (schema.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(schema.type))) {
		errors.push(`${path}: unsupported schema type`);
	}
	if (schema.type !== undefined && typeof schema.type !== 'string') errors.push(`${path}: schema type must be a string`);
	if ('enum' in schema && (!Array.isArray(schema.enum) || !schema.enum.length)) errors.push(`${path}: enum must be a nonempty array`);
	if ('properties' in schema || 'required' in schema || 'additionalProperties' in schema) {
		if (schema.type !== 'object') errors.push(`${path}: object constraints require explicit type "object" locally`);
		if ('properties' in schema && !isPlainObject(schema.properties)) errors.push(`${path}: properties must be an object`);
		if ('required' in schema && (!Array.isArray(schema.required) || !schema.required.every((key) => typeof key === 'string'))) errors.push(`${path}: required must be an array of strings`);
		if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean') errors.push(`${path}: only boolean additionalProperties is supported locally`);
		if (isPlainObject(schema.properties)) {
			for (const [key, child] of Object.entries(schema.properties)) checkSchemaSupport(child, `${path}.${key}`, errors, depth + 1);
		}
	}
	if ('items' in schema) {
		if (schema.type !== 'array') errors.push(`${path}: items requires explicit type "array" locally`);
		checkSchemaSupport(schema.items, `${path}[]`, errors, depth + 1);
	}
}

function jsonEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
	if (isPlainObject(left) && isPlainObject(right)) {
		return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
	}
	return false;
}

function validateSimpleJsonSchema(value: unknown, schema: AnyRecord, path: string, errors: string[], depth = 0): void {
	if (depth > 12) {
		errors.push(`${path}: schema nesting exceeds the supported depth (12)`);
		return;
	}
	if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(value, entry))) errors.push(`${path} must match an enum value`);
	if ('const' in schema && !jsonEqual(value, schema.const)) errors.push(`${path} must match const`);

	const type = typeof schema.type === 'string' ? schema.type : undefined;
	if (type === 'null') {
		if (value !== null) errors.push(`${path} must be null`);
		return;
	}

	if (type === 'object' || (!type && 'properties' in schema)) {
		if (!isPlainObject(value)) {
			errors.push(`${path} must be an object`);
			return;
		}

		const props = isPlainObject(schema.properties) ? (schema.properties as AnyRecord) : {};
		const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
		const additional = schema.additionalProperties;

		for (const r of required) {
			if (typeof r === 'string' && !(r in value)) {
				errors.push(`${path}.${r} is required`);
			}
		}

		for (const [k, propSchema] of Object.entries(props)) {
			if (!(k in value)) continue;
			if (isPlainObject(propSchema)) {
				validateSimpleJsonSchema((value as AnyRecord)[k], propSchema, `${path}.${k}`, errors, depth + 1);
			}
		}

		if (additional === false) {
			for (const k of Object.keys(value)) {
				if (!(k in props)) errors.push(`${path}.${k} is not allowed`);
			}
		}

		return;
	}

	if (type === 'array') {
		if (!Array.isArray(value)) {
			errors.push(`${path} must be an array`);
			return;
		}
		const items = isPlainObject(schema.items) ? (schema.items as AnyRecord) : undefined;
		if (items) {
			for (let i = 0; i < value.length; i++) {
				validateSimpleJsonSchema(value[i], items, `${path}[${i}]`, errors, depth + 1);
			}
		}
		return;
	}

	if (type === 'string') {
		if (typeof value !== 'string') errors.push(`${path} must be a string`);
		return;
	}
	if (type === 'number') {
		if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path} must be a number`);
		return;
	}
	if (type === 'integer') {
		if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${path} must be an integer`);
		return;
	}
	if (type === 'boolean') {
		if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
		return;
	}
}

// -----------------------------
// LLM preSend: NEW UI (thinking + responseFormatType + responseJsonSchema)
// -----------------------------
export async function preSendChatCompletions(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const model = String(this.getNodeParameter('llmModel', '', { extractValue: true }) || '').trim();
	if (!model) throw new NodeOperationError(this.getNode(), 'LLM: "Model" is empty');

	const thinking = Boolean(this.getNodeParameter('thinking', false));
	const responseFormatType = String(this.getNodeParameter('responseFormatType', 'text') || 'text');
	const responseJsonSchemaParam = this.getNodeParameter('responseJsonSchema', '');

	const systemPrompt = String(this.getNodeParameter('systemPrompt', '') || '').trim();
	const userMessage = String(this.getNodeParameter('userMessage', '') || '').trim();
	if (!userMessage) throw new NodeOperationError(this.getNode(), 'LLM: "User Message" is empty');

	const messages: Array<{ role: string; content: string }> = [];
	if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
	messages.push({ role: 'user', content: userMessage });

	const opts = (this.getNodeParameter('llmOptions', {}) as IDataObject) ?? {};
	const temperature = (opts as AnyRecord).temperature !== undefined ? Number((opts as AnyRecord).temperature) : undefined;
	const maxTokens = (opts as AnyRecord).maxTokens !== undefined ? Number((opts as AnyRecord).maxTokens) : undefined;
	const formatParam = (opts as AnyRecord).format;

	const payload: AnyRecord = { model, messages, thinking };

	if (Number.isFinite(temperature)) payload.temperature = temperature;
	if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens;

	if (responseFormatType === 'json_object') {
		payload.response_format = { type: 'json_object' };
	} else if (responseFormatType === 'json_schema') {
		let schemaObj: AnyRecord | null = null;

		if (typeof responseJsonSchemaParam === 'string') {
			try {
				schemaObj = JSON.parse(responseJsonSchemaParam || '{}') as AnyRecord;
			} catch {
				throw new NodeOperationError(this.getNode(), 'LLM: "JSON Schema" is not valid JSON');
			}
		} else if (isPlainObject(responseJsonSchemaParam)) {
			schemaObj = responseJsonSchemaParam as AnyRecord;
		}

		if (!schemaObj || typeof schemaObj.name !== 'string' || !isPlainObject(schemaObj.schema)) {
			throw new NodeOperationError(this.getNode(), 'LLM: "JSON Schema" must contain "name" and "schema" fields');
		}

		payload.response_format = { type: 'json_schema', json_schema: schemaObj };
	}

	// Optional "format" (advanced)
	if (typeof formatParam === 'string' && formatParam.trim()) {
		try {
			const fmt = JSON.parse(formatParam);
			if (fmt && typeof fmt === 'object') payload.format = fmt as AnyRecord;
		} catch {
			throw new NodeOperationError(this.getNode(), 'LLM: "Format (Ollama JSON)" is not valid JSON');
		}
	} else if (isPlainObject(formatParam) && Object.keys(formatParam).length) {
		payload.format = formatParam;
	}

	requestOptions.body = payload;
	requestOptions.json = true;

	return requestOptions;
}

// -----------------------------
// LLM postReceive: EXACT OUTPUT RULES YOU ASKED
// -----------------------------
export async function postReceiveLlmChat(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	responseData: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = parseMaybeJson(responseData.body);

	const responseFormatType = String(this.getNodeParameter('responseFormatType', 'text') || 'text');
	const schemaParam = this.getNodeParameter('responseJsonSchema', '');

	let contentStr = '';
	let id = '';
	let model = '';
	let created = 0;
	let choices: IDataObject[] = [];
	let usage: IDataObject = {};

	if (isObject(body)) {
		id = typeof body.id === 'string' ? body.id : '';
		model = typeof body.model === 'string' ? body.model : '';
		created = typeof body.created === 'number' ? body.created : 0;
		choices = Array.isArray(body.choices) ? (body.choices as unknown as IDataObject[]) : [];
		usage = isObject(body.usage) ? (body.usage as IDataObject) : {};

		const first = Array.isArray(body.choices) ? body.choices[0] : undefined;
		const msg = isObject(first) ? (first as AnyRecord).message : undefined;
		const content = isObject(msg) ? (msg as AnyRecord).content : undefined;
		contentStr = typeof content === 'string' ? content : '';
	}

	return items.map((item) => {
		// TEXT: only answer
		if (responseFormatType === 'text') {
			return { json: { response: contentStr } as IDataObject, binary: item.binary };
		}

		// JSON_OBJECT: metadata + raw + response, BUT WITHOUT parsed/schema_valid/schema_errors
		if (responseFormatType === 'json_object') {
			return {
				json: {
					id,
					model,
					created,
					choices,
					usage,
				} as IDataObject,
				binary: item.binary,
			};
		}

		// JSON_SCHEMA: response + parsed + schema_valid + schema_errors
		const parsedTry = contentStr.trim()
			? tryParseJsonFromContent(contentStr)
			: { ok: false, value: null, error: 'Empty response' };

		const errors: string[] = [];

		let schemaObj: AnyRecord | null = null;
		if (typeof schemaParam === 'string') {
			try {
				schemaObj = JSON.parse(schemaParam || '{}') as AnyRecord;
			} catch {
				schemaObj = null;
			}
		} else if (isPlainObject(schemaParam)) {
			schemaObj = schemaParam as AnyRecord;
		}

		if (!schemaObj || typeof schemaObj.name !== 'string' || !isPlainObject(schemaObj.schema)) {
			errors.push('Schema config is invalid: expected { name: string, schema: object }');
		} else if (!parsedTry.ok) {
			errors.push(`Output is not valid JSON: ${parsedTry.error ?? 'unknown error'}`);
		} else {
			checkSchemaSupport(schemaObj.schema, '$', errors);
			if (!errors.length) validateSimpleJsonSchema(parsedTry.value, schemaObj.schema as AnyRecord, '$', errors);
		}

		return {
			json: {
				response: contentStr,
				parsed: (parsedTry.ok ? parsedTry.value : null) as IDataObject,
				schema_valid: errors.length === 0,
				schema_errors: errors,
			} as IDataObject,
			binary: item.binary,
		};
	});
}

// Optional (not used in UI now, but harmless)
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
					const idv = (m as AnyRecord).id;
					return typeof idv === 'string' ? idv : null;
				})
				.filter((x): x is string => typeof x === 'string');

			out.modelIds = modelIds;
		}

		return { json: out, binary: item.binary };
	});
}
