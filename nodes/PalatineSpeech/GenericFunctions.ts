import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';

import { NodeApiError } from 'n8n-workflow';

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions;

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

/**
 * Standard authenticated request helper (verification-friendly):
 * - uses IHttpRequestOptions
 * - uses httpRequestWithAuthentication (not deprecated request())
 */
export async function palatineApiRequest(
	this: RequestContext,
	options: IHttpRequestOptions,
): Promise<IDataObject> {
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

/**
 * Convenience wrapper for returning raw (non-JSON) responses
 */
export async function palatineApiRequestRaw(
	this: RequestContext,
	options: IHttpRequestOptions,
): Promise<string> {
	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'palatineSpeechNodeApi',
			{
				...options,
				json: false,
			},
		);

		return typeof response === 'string' ? response : JSON.stringify(response);
	} catch (error) {
		throw new NodeApiError(this.getNode(), toJsonError(error));
	}
}