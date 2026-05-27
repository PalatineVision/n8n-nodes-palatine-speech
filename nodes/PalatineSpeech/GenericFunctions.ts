import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	JsonObject,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError } from 'n8n-workflow';

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions;
type AnyRecord = Record<string, unknown>;

function toJsonError(error: unknown): JsonObject {
	if (error instanceof Error) {
		const json: JsonObject = { name: error.name, message: error.message };
		if (typeof error.stack === 'string') json.stack = error.stack;
		return json;
	}
	if (typeof error === 'string') return { message: error };
	if (typeof error === 'object' && error !== null) return error as JsonObject;
	return { message: 'Unknown error' };
}

export async function palatineApiRequest(this: RequestContext, options: IHttpRequestOptions): Promise<IDataObject> {
	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'palatineSpeechNodeApi',
			options,
		);

		return response as unknown as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), toJsonError(error));
	}
}

export async function palatineApiRequestRaw(this: RequestContext, options: IHttpRequestOptions): Promise<string> {
	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(this, 'palatineSpeechNodeApi', {
			...options,
			json: false,
		});

		return typeof response === 'string' ? response : JSON.stringify(response);
	} catch (error) {
		throw new NodeApiError(this.getNode(), toJsonError(error));
	}
}

function normalizeBaseUrl(raw: unknown): string {
	const base = String(raw ?? '').trim();
	return base.endsWith('/') ? base.slice(0, -1) : base;
}

function toLower(value: unknown): string {
	return typeof value === 'string' ? value.toLowerCase() : '';
}

function itemMatchesFilter(item: INodeListSearchItems, filter?: string): boolean {
	if (!filter) return true;
	const f = filter.toLowerCase();
	const name = toLower(item.name);
	const value = String(item.value ?? '').toLowerCase();
	return name.includes(f) || value.includes(f);
}

/**
 * Used by resourceLocator(Model) to fetch models live
 */
export async function getLlmModels(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const creds = (await this.getCredentials('palatineSpeechNodeApi')) as unknown as AnyRecord;
	const baseUrl = normalizeBaseUrl(creds?.baseUrl);

	if (!baseUrl) {
		throw new NodeOperationError(this.getNode(), 'Credential "Base URL" is empty');
	}

	const resp = (await palatineApiRequest.call(this, {
		method: 'GET',
		url: '/api/llm/v1/models',
		baseURL: baseUrl,
		json: true,
	})) as unknown as AnyRecord;

	const data = Array.isArray(resp?.data) ? (resp.data as unknown[]) : [];

	const results: INodeListSearchItems[] = [];

	for (const m of data) {
		const id = isRecord(m) && typeof m.id === 'string' ? m.id : '';
		if (!id) continue;
		results.push({ name: id, value: id });
	}

	const filtered = results
		.filter((i) => itemMatchesFilter(i, filter))
		.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

	return { results: filtered };
}

function isRecord(v: unknown): v is AnyRecord {
	return typeof v === 'object' && v !== null;
}