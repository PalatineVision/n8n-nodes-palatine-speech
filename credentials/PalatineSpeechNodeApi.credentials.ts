import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class PalatineSpeechNodeApi implements ICredentialType {
	name = 'palatineSpeechNodeApi';
	displayName = 'Palatine Speech API';
	documentationUrl = 'https://docs.speech.palatine.ru/api-reference';
	icon: Icon = { light: 'file:../icons/logoLight.svg', dark: 'file:../icons/logoDark.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.palatine.ru',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{"Bearer " + $credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ ($credentials.baseUrl || "").endsWith("/") ? ($credentials.baseUrl || "").slice(0, -1) : ($credentials.baseUrl || "") }}',
			url: '/api/llm/v1/models',
			method: 'GET',
		},
	};
}