![README banner](https://github.com/palatine-vision/n8n-nodes-palatine-speech/blob/main/docs/assets/Header.png)

# n8n-nodes-palatine-speech

> Designed for seamless integration of **Palatine Speech API** into n8n workflows.

This is an n8n community node that integrates [Palatine Speech](https://speech.palatine.ru/) into your workflows and enables audio processing capabilities such as transcription, diarization, sentiment analysis, and summarization.

## Navigation

[Supported Operations](#supported-operations)\
[Installation](#installation)\
[Credentials](#credentials)\
[Waiting for Results](#waiting-for-results)\
[Workflow Example](#workflow-example)\
[Use Cases](#use-cases)\
[Compatibility](#compatibility)\
[Useful Resources](#useful-resources)\
[Keywords](#keywords)\
[License](#license)\
[Support](#support)

> Looking for a Russian version? [Here](https://gist.github.com/Valeronich/b5d116fd4ca251ff672eda7d2a530a61)

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

Generate a response from the Palatine Speech LLM using a user message and an optional system prompt.
You can select the model, tune generation parameters (`temperature`, `max_tokens`), and optionally enable `thinking` for deeper reasoning.

Supported response formats:
- `Text`
- `JSON Object`
- `JSON Schema`

Local JSON Schema validation supports single types (`object`, `array`, `string`, `number`, `integer`, `boolean`, `null`), `properties`, `required`, boolean `additionalProperties`, an object `items` schema, `enum` and `const`. Object and array constraints require an explicit type. Unsupported constraints, malformed schemas and nesting beyond 12 levels return `schema_valid: false` with an explanation in `schema_errors`; they are never silently treated as validated. The schema sent to the API is unchanged.

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

## Waiting for Results

File processing and text summarization create an API task and check its status until the result is ready. Configure **Polling Options** on the node:

| Setting | Default | Behavior |
|---------|---------|----------|
| Max Wait Time (Seconds) | `0` (automatic) | Maximum elapsed time after task creation, including status requests and delays. Enter a positive value to set your own limit, up to 604800 seconds (7 days). |
| Polling Interval (Ms) | `5000` for transcription, diarization and sentiment; `20000` for summaries | Delay after a pending status response. Accepts 500–900000 ms. |
| Audio Duration (Seconds) | `0` (unknown) | Optional duration supplied by your workflow, including an expression such as `{{ $json.audioDurationSeconds }}`. Used to calculate the automatic waiting budget for file processing. |
| Max Poll Attempts | `0` | Optional additional cap on status requests. `0` means the elapsed time limit is the only polling limit. |

Automatic waiting allows the greater of **twice the supplied audio duration plus 5 minutes** and the operation's baseline: **30 minutes** for transcription, diarization and sentiment, or **10000 seconds** for summaries. The automatic budget is capped at 7 days. These are waiting budgets, not estimates or guarantees of processing speed. Without a known duration, the baseline is used. A one-hour recording therefore gets a transcription budget of **125 minutes**. An explicit Max Wait Time always takes precedence over the duration calculation.

Audio duration is not extracted from the file or guessed from its size. Supply it from an upstream metadata step, or set Max Wait Time directly. Text summarization ignores Audio Duration. A successful result is returned immediately; the node does not wait out the entire budget.

**Existing workflows:** explicitly saved intervals and attempt limits are preserved, including values such as `500`, `1000`, `200` and `300`. If your workflow has `Max Poll Attempts = 200`, that cap still applies. Remove the option or set it to `0` to use the time budget without an attempt cap. If both limits are set, polling stops at whichever is reached first. Invalid settings produce an error instead of being silently replaced.

The budget starts after task creation, so the initial file upload is not included. An n8n workflow or instance execution timeout may still stop the node sooner. A polling timeout does not cancel the remote API task. Connection errors such as `connect ETIMEDOUT` are separate from this waiting limit; increasing the budget does not fix an unreachable API.

For intermittent connection errors, open the node's **Settings** and enable **Retry On Fail**, with **Max Tries: 3** and **Wait Between Tries: 5000 ms**. This retries the whole node and can create another API task if the previous task was already accepted.

## Workflow Example

1. `Webhook` -> Receive an audio file
2. `Config` -> Configure parameters
3. `Palatine Speech` -> Transcribe the file
4. `Create record` -> Create a table record
5. `Telegram` -> Send the result to a chat

![workflow example](https://github.com/palatine-vision/n8n-nodes-palatine-speech/blob/main/docs/assets/WorkflowExample.png)

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

Release checks cover lint, TypeScript compilation, automated tests and the n8n community package scanner. These checks do not replace testing your workflow on your installed n8n version.

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
