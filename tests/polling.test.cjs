const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const workflow = require('n8n-workflow');

// Run the real source with a virtual clock and HTTP responses. No API calls or real delays.
const sourceDirectory = path.resolve(__dirname, '../nodes/PalatineSpeech/descriptions');
const compiled = new Map();
function loadSource(name, clock) {
	if (!compiled.has(name)) {
		compiled.set(name, ts.transpileModule(fs.readFileSync(path.join(sourceDirectory, `${name}.ts`), 'utf8'), {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		}).outputText);
	}
	const exports = {};
	vm.runInNewContext(compiled.get(name), {
		exports,
		Buffer, ArrayBuffer, Uint8Array, FormData, Blob, URL,
		Date: class extends Date { static now() { return clock.now; } },
		require(id) {
			if (id === 'n8n-workflow') return {
				...workflow,
				sleep: async (ms) => { clock.sleeps.push(ms); clock.now += ms; clock.onSleep?.(); },
			};
			if (id === './polling') return loadSource('polling', clock);
			throw new Error(`Unexpected import: ${id}`);
		},
	}, { filename: `${name}.js` });
	return exports;
}

function setup(polling = {}, operation = 'transcribe', respond = () => ({ status: 'processing' })) {
	const clock = { now: 0, sleeps: [] };
	const controller = new AbortController();
	const requests = [];
	const input = { json: {}, binary: { data: { data: '', fileName: 'call.wav', mimeType: 'audio/wav' } } };
	const params = { polling, operation, resource: operation === 'summarizeText' ? 'llm' : 'audio', text: 'Summary input' };
	const context = {
		getNode: () => ({ name: 'Palatine Speech', type: 'palatineSpeech', typeVersion: 3, position: [0, 0], parameters: {} }),
		getNodeParameter: (name, fallback) => params[name] ?? fallback,
		getInputData: () => input,
		getExecutionCancelSignal: () => controller.signal,
		getCredentials: async () => ({ baseUrl: 'https://api.example.invalid' }),
		helpers: {
			httpRequestWithAuthentication: async (_credential, options) => {
				requests.push({ ...options, at: clock.now });
				return await respond(requests.length, clock, options);
			},
			getBinaryDataBuffer: async () => { throw new Error('File must not be read in this test'); },
		},
	};
	const utils = loadSource('utils', clock);
	return {
		clock, controller, requests, context, utils, params,
		config: (kind = 'transcribe') => loadSource('polling', clock).getPollingConfig.call(context, kind),
		run: () => utils.postReceivePalatine.call(context, [input], { body: { task_id: 'test-task' } }),
	};
}

test('explicit former defaults are preserved for every task kind', () => {
	for (const kind of ['transcribe', 'diarize', 'sentiment', 'summarize']) {
		for (const interval of [500, 1000, 20000]) {
			for (const attempts of [200, 300, 500]) {
				const config = setup({ pollIntervalMs: interval, maxPollAttempts: attempts }).config(kind);
				assert.equal(config.pollIntervalMs, interval);
				assert.equal(config.maxPollAttempts, attempts);
			}
		}
	}
});

test('missing settings use time budgets and no implicit attempt cap', () => {
	const ctx = setup();
	assert.equal(ctx.config().maxWaitMs, 1800000);
	assert.equal(ctx.config().pollIntervalMs, 5000);
	assert.equal(ctx.config().maxPollAttempts, 0);
	assert.equal(ctx.config('summarize').maxWaitMs, 10000000);
	assert.equal(ctx.config('summarize').pollIntervalMs, 20000);
});

test('duration expands the budget, explicit timeout overrides it, and automatic budget has a ceiling', () => {
	assert.equal(setup({ audioDurationSeconds: 3600 }).config().maxWaitMs, 7500000);
	assert.equal(setup({ audioDurationSeconds: 60 }).config().maxWaitMs, 1800000);
	assert.equal(setup({ audioDurationSeconds: '3600', maxWaitSeconds: '120' }).config().maxWaitMs, 120000);
	assert.equal(setup({ audioDurationSeconds: 604800 }).config().maxWaitMs, 604800000);
	assert.equal(setup({ audioDurationSeconds: 7200 }, 'summarizeText').config('summarize').maxWaitMs, 10000000);
});

test('invalid supplied values fail instead of being silently replaced', () => {
	for (const [key, value] of [
		['pollIntervalMs', 499], ['pollIntervalMs', 1000.5], ['pollIntervalMs', null],
		['pollIntervalMs', ''], ['pollIntervalMs', true], ['pollIntervalMs', NaN],
		['maxPollAttempts', -1], ['maxPollAttempts', 2.5], ['maxPollAttempts', 1000001],
		['maxWaitSeconds', Infinity], ['maxWaitSeconds', -5], ['maxWaitSeconds', 604801],
		['audioDurationSeconds', 'bad'],
	]) assert.throws(() => setup({ [key]: value }).config(), new RegExp(key));
});

test('default waiting survives more than 200 checks and more than 100 seconds', async () => {
	const ctx = setup({ pollIntervalMs: 500 }, 'transcribe', (n) => n === 242
		? { status: 'completed', result: { text: 'Long recording' } } : { status: 'processing' });
	const result = await ctx.run();
	assert.equal(ctx.requests.length, 242);
	assert.equal(ctx.clock.now, 120500);
	assert.equal(result[0].json.transcription, 'Long recording');
	assert.ok(ctx.requests.every((r) => r.method === 'GET' && r.url.endsWith('/test-task')));
});

test('explicit attempt cap stops exactly at the limit without an extra sleep', async () => {
	const ctx = setup({ pollIntervalMs: 1000, maxPollAttempts: 3 });
	await assert.rejects(ctx.run(), /3 attempts/);
	assert.deepEqual(ctx.requests.map((r) => r.at), [0, 1000, 2000]);
	assert.equal(ctx.clock.now, 2000);
});

test('elapsed limit counts HTTP time and bounds the final wait and request timeout', async () => {
	const ctx = setup({ maxWaitSeconds: 2, pollIntervalMs: 1000 }, 'transcribe', (_n, clock) => {
		clock.now += 400;
		return { status: 'processing' };
	});
	await assert.rejects(ctx.run(), /test-task.*maximum wait time \(2 seconds\)/);
	assert.deepEqual(ctx.requests.map((r) => r.at), [0, 1400]);
	assert.deepEqual(ctx.requests.map((r) => r.timeout), [2000, 600]);
	assert.equal(ctx.clock.now, 2000);
});

test('long interval cannot overshoot the wait budget', async () => {
	const ctx = setup({ maxWaitSeconds: 0.25, pollIntervalMs: 900000 });
	await assert.rejects(ctx.run(), /maximum wait time/);
	assert.equal(ctx.requests.length, 1);
	assert.equal(ctx.requests[0].timeout, 250);
	assert.equal(ctx.clock.now, 250);
});

test('a response after the deadline cannot be returned as success', async () => {
	const ctx = setup({ maxWaitSeconds: 1 }, 'transcribe', (_n, clock) => {
		clock.now += 1100;
		return { status: 'completed', result: 'Late response' };
	});
	await assert.rejects(ctx.run(), /maximum wait time/);
});

test('terminal failures and unexpected HTTP errors do not start new API jobs', async () => {
	const failed = setup({}, 'transcribe', () => ({ status: 'failed' }));
	await assert.rejects(failed.run(), /test-task failed/);
	assert.equal(failed.requests.length, 1);
	assert.equal(failed.clock.sleeps.length, 0);
	const httpError = setup({}, 'transcribe', () => { throw new Error('connect ETIMEDOUT'); });
	await assert.rejects(httpError.run());
	assert.equal(httpError.requests.length, 1);
});

test('cancellation before a request and during a long interval stops polling', async () => {
	const before = setup();
	before.controller.abort();
	await assert.rejects(before.run(), /cancelled/);
	assert.equal(before.requests.length, 0);
	const during = setup({ pollIntervalMs: 900000 });
	during.clock.onSleep = () => during.controller.abort();
	await assert.rejects(during.run(), /cancelled/);
	assert.equal(during.requests.length, 1);
	assert.equal(during.clock.now, 1000);
	assert.equal(during.requests[0].abortSignal, during.controller.signal);
});

test('all polling operations preserve their result shape', async () => {
	for (const [operation, field, result] of [
		['transcribe', 'transcription', 'text'], ['diarize', 'diarization', { segments: [] }],
		['sentiment', 'sentiment', { sentiment: 'neutral' }], ['summarizeFile', 'summary', 'summary'],
		['summarizeText', 'summary', 'summary'],
	]) {
		const ctx = setup({}, operation, () => ({ status: 'completed', result }));
		const out = await ctx.run();
		assert.deepEqual(out[0].json[field], result);
		assert.equal(ctx.requests.length, 1);
	}
});

test('invalid polling settings are rejected before reading or uploading a file', async () => {
	const ctx = setup({ pollIntervalMs: -1 });
	await assert.rejects(ctx.utils.preSendFile.call(ctx.context, {}), /pollIntervalMs/);
	await assert.rejects(ctx.utils.preSendSummarizeText.call(ctx.context, {}), /pollIntervalMs/);
	assert.equal(ctx.requests.length, 0);
});

test('file upload preserves filename, MIME type and binary bytes', async () => {
	const ctx = setup();
	const bytes = Buffer.from([0, 1, 127, 255]);
	ctx.context.helpers.getBinaryDataBuffer = async (property) => {
		assert.equal(property, 'data');
		return bytes;
	};
	const request = await ctx.utils.preSendFile.call(ctx.context, {});
	const file = request.body.get('file');
	assert.equal(file.name, 'call.wav');
	assert.equal(file.type, 'audio/wav');
	assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
});

test('external subtitle downloads never use API credentials and redirects are disabled', async () => {
	const subtitle = '1\n00:00:00,000 --> 00:00:01,000\nHello';
	for (const origin of ['https://storage.example.invalid', 'https://api.example.invalid', 'http://api.example.invalid', 'https://api.example.invalid:8443']) {
		const url = `${origin}/result.srt`;
		const ctx = setup({}, 'diarize', (n, _clock, options) => {
			assert.equal(options.disableFollowRedirect, true);
			if (n === 1) return { status: 'completed', result: { download_url: url } };
			if (options.url === url) return subtitle;
			return {};
		});
		ctx.params.responseFormat = 'srt';
		const plain = [];
		ctx.context.helpers.httpRequest = async (options) => {
			plain.push(options);
			assert.equal(options.headers, undefined);
			assert.equal(options.auth, undefined);
			assert.equal(options.disableFollowRedirect, true);
			return subtitle;
		};
		const out = await ctx.run();
		assert.equal(out[0].json.subtitles, subtitle);
		const sameOrigin = origin === 'https://api.example.invalid';
		assert.equal(plain.length, sameOrigin ? 0 : 1);
		assert.equal(ctx.requests.some((request) => request.url === url), sameOrigin);
	}
});

async function validateOutput(schema, value) {
	const ctx = setup();
	ctx.params.responseFormatType = 'json_schema';
	ctx.params.responseJsonSchema = JSON.stringify({ name: 'test', schema });
	const out = await ctx.utils.postReceiveLlmChat.call(ctx.context, [{ json: {} }], {
		body: { choices: [{ message: { content: JSON.stringify(value) } }] },
	});
	return out[0].json;
}

test('schema validation enforces enum, const and null, including object equality', async () => {
	const schema = { type: 'object', properties: { answer: { type: 'string', enum: ['allowed'] } }, required: ['answer'], additionalProperties: false };
	assert.equal((await validateOutput(schema, { answer: 'forbidden' })).schema_valid, false);
	assert.equal((await validateOutput(schema, { answer: 'allowed' })).schema_valid, true);
	assert.equal((await validateOutput({ const: { a: 1, b: 2 } }, { b: 2, a: 1 })).schema_valid, true);
	assert.equal((await validateOutput({ const: 1 }, 2)).schema_valid, false);
	assert.equal((await validateOutput({ type: 'null' }, null)).schema_valid, true);
	assert.equal((await validateOutput({ type: 'null' }, 'null')).schema_valid, false);
});

test('unsupported or malformed schema constraints never report successful validation', async () => {
	for (const schema of [
		{ type: 'string', minLength: 10 }, { anyOf: [{ type: 'string' }] },
		{ type: ['string', 'null'] }, { type: 'object', properties: { optional: false } },
		{ type: 'object', additionalProperties: { type: 'string' } },
		{ type: 'array', items: [{ type: 'string' }] }, { enum: [] },
		{ required: ['answer'] }, { type: 'object', properties: [] },
	]) {
		const result = await validateOutput(schema, {});
		assert.equal(result.schema_valid, false, JSON.stringify(schema));
		assert.ok(result.schema_errors.length > 0);
	}
	let deep = { type: 'string' };
	for (let i = 0; i < 14; i++) deep = { type: 'object', properties: { child: deep } };
	assert.equal((await validateOutput(deep, {})).schema_valid, false);
});
