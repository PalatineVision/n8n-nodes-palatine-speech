import type { IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';

export class PalatineSpeechNodeApi implements ICredentialType {
	name = 'PalatineSpeechNodeApi';
	displayName = 'Palatine Speech API';
	documentationUrl = 'https://docs.speech.palatine.ru/api-reference';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.palatine.ru',
			placeholder: 'https://api.palatine.ru',
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
}

