![README banner](https://github.com/haxbxbdbhshs/Palatine-Speech-Node-n8n/blob/main/docs/assets/Header.png)

# n8n-nodes-palatine-speech

> Designed for seamless integration of **Palatine Speech API** into n8n workflows.

This is an n8n community node that integrates [Palatine Speech](https://speech.palatine.ru/) into your workflows and enables audio processing capabilities such as transcription, diarization, sentiment analysis, and summarization.

## Navigation

[Supported Operations](#supported-operations)\
[Installation](#installation)\
[Credentials](#credentials)\
[Workflow Example](#workflow-example)\
[Use Cases](#use-cases)\
[Compatibility](#compatibility)\
[Useful Resources](#useful-resources)\
[Keywords](#keywords)\
[License](#license)\
[Support](#support)

> Looking for a Russian version? [Here](https://gist.github.com/haxbxbdbhshs/b7dfc63659d0417b3d73d0b1d0a3002f)

## Supported Operations

For details on each operation, see the Palatine Speech [documentation](https://docs.speech.palatine.ru/documentation/quick_start/transcription).

- [Full list of supported file types](https://docs.speech.palatine.ru/documentation/technical_information/supported_files)
- [Full list of supported languages](https://docs.speech.palatine.ru/documentation/technical_information/supported_languages)

### [Transcribe - speech transcription](https://docs.speech.palatine.ru/api-reference/transcribe-polling-api/transcribe)

Speech-to-Text (STT) converts audio/video into a written transcript.  
It supports multiple languages and can automatically detect the language spoken in the recording.  
It is well-suited for calls, interviews, lectures, and any other recordings where an accurate transcript is required.

### [Diarize - speaker diarization](https://docs.speech.palatine.ru/api-reference/diarization-polling-api/diarize)

Speaker diarization segments audio by speaker and labels speaker turns.  
This is useful for meetings and interviews, where maintaining conversation structure matters.

### [Sentiment Analysis - sentiment analysis](https://docs.speech.palatine.ru/api-reference/sentiment-analysis-polling-api/sentiment-analysis)

Determines the emotional tone of speech in audio/video (and can also analyze text).  
The result is a ranked list of sentiment classes with probabilities, where the first item is the most likely:  
`Very Negative`, `Negative`, `Neutral`, `Positive`, `Very Positive`.

### [Summarize - audio summarization](https://docs.speech.palatine.ru/api-reference/ai-service/summarize-file)

Generates a structured summary from audio/video or pre-existing text.  
In addition to built-in scenarios such as `meeting_summary`, it supports `user_prompt`, allowing you to define custom output structures (bullet points, decisions, action items, risks, Q&A, etc.).

### [Message to model - OpenAI-compatible chat](https://docs.speech.palatine.ru/api-reference/chat-completions/chat-completions)

Generate a response from the Palatine Speech LLM using a list of messages (`system`, `user`, `assistant`).  
You can select the model, tune generation parameters (`temperature`, `max_tokens`), and optionally enable `thinking` for deeper reasoning.

Supported response formats:
- `Text`
- `JSON Object`
- `JSON Schema`

## Installation

1. In your n8n instance, go to **Settings > Community Nodes -> Install**
2. Enter: `n8n-nodes-palatine-speech`
3. Click **Install**

> Make sure the environment variable `N8N_COMMUNITY_PACKAGES_ENABLED=true` is set.

## Credentials

1. Go to **Credentials -> + Create**
2. Find **Palatine Speech API**
3. Fill in the fields:
   - **API Key** - available in your Palatine Speech dashboard
   - **Base URL** - default is `https://api.palatine.ru`

## Workflow Example

1. `Webhook` -> Receive an audio file
2. `Config` -> Configure parameters
3. `Palatine Speech` -> Transcribe the file
4. `Create record` -> Create a table record
5. `Telegram` -> Send the result to a chat

![workflow example](https://github.com/haxbxbdbhshs/Palatine-Speech-Node-n8n/blob/main/docs/assets/WorkflowExample.png)

## Use Cases

- **Meeting summaries**  
Use `Summarize` (`meeting_summary`) to generate summaries, decisions, and action items grouped by owner and due date.  
Custom prompts can be used for additional structure.

- **Lecture/webinar notes**  
Recording -> `Transcribe` -> full transcript saved alongside materials.

- **Automatic subtitles for video**  
Extract audio -> `Transcribe` + `Diarize` -> convert to SRT/VTT.

- **Customer support assistant**  
Use `Sentiment Analysis` to determine tone and assign ticket priority.

- **Action items extraction**  
Use **Message to model** with **JSON Schema** to extract structured tasks (title, owner, due date, priority) and associated risks.  
Results can be sent to Jira / Notion / Asana or team chat.

## Compatibility

Tested with n8n v1.39.1 and later.

## Useful Resources

- [Palatine Speech documentation](https://docs.speech.palatine.ru/documentation/quick_start/transcription)
- [n8n Community Nodes guide](https://docs.n8n.io/integrations/community-nodes/)
- [Official n8n GitHub](https://github.com/n8n-io/n8n)

## Keywords

`n8n-community-node-package`, `n8n`, `palatine`, `speech-to-text`, `transcribe`, `transcription`, `stt`, `audio`, `ai`, `automation`, `voice-to-text`, `speech-recognition`, `audio-transcription`, `audio2text`, `audio-processing`, `diarization`, `speaker-diarization`, `speaker-segmentation`, `summarization`, `audio-summarization`, `sentiment-analysis`, `emotion-detection`, `tone-analysis`, `llm`, `chat-completions`, `openai-compatible`, `structured-output`, `json-schema`

## License
MIT

## Support
Need help? Contact our Telegram support bot: [@Speech_Palatine_Support_Bot](https://t.me/Speech_Palatine_Support_Bot)
