![README banner](https://github.com/palatine-vision/n8n-nodes-palatine-speech/blob/main/docs/assets/Header.png)

# n8n-nodes-palatine-speech

> Designed for seamless integration of **Palatine Speech API** into n8n workflows.

This is an n8n community node that integrates [Palatine Speech](https://speech.palatine.ru/) into your workflows and enables audio processing tasks such as transcription, diarization, sentiment analysis, and summarization.

## Navigation

[Supported Operations](#supported-operations)\
[Installation](#installation)\
[Credentials](#credentials)\
[Workflow Example](#workflow-example)\
[Use Cases](#use-cases) \
[Compatibility](#compatibility)\
[Useful Resources](#useful-resources)\
[Keywords](#keywords) \
[License](#license) \
[Support](#support)

> Looking for a Russian version? [Here](https://gist.github.com/Valeronich/b5d116fd4ca251ff672eda7d2a530a61)

## Supported Operations

For details on each operation, see the Palatine Speech [documentation](https://docs.speech.palatine.ru/documentation/quick_start/transcription). You can also open the documentation by clicking the operation title below.

* [Full list of supported file types](https://docs.speech.palatine.ru/documentation/technical_information/supported_files)
* [Full list of supported languages](https://docs.speech.palatine.ru/documentation/technical_information/supported_languages)

### [Transcribe — speech transcription](https://docs.speech.palatine.ru/api-reference/transcribe/transcribe-polling-api/transcribe)

Speech-to-Text (STT) converts audio/video into a written transcript.
It supports multiple languages and can automatically detect the language spoken in the recording.
It is well-suited for calls, interviews, lectures, and any other recordings where you need an accurate text version of what was said.

### [Diarize — speaker diarization](https://docs.speech.palatine.ru/api-reference/diarization/diarization-polling-api/diarize)

Speaker diarization separates a recording into speaker segments and identifies who is speaking in each segment. This is useful for meetings and interviews, where keeping the conversation structure by speaker matters.

### [Sentiment Analysis — sentiment analysis](https://docs.speech.palatine.ru/api-reference/sentiment-analysis/sentiment-analysis-polling-api/sentiment-analysis)

Determines the emotional tone of speech in audio/video (and can also analyze text). The result is a ranked list of sentiment classes with probabilities, where the first item is the most likely: `Very Negative`, `Negative`, `Neutral`, `Positive`, `Very Positive`.

### [Summarize — audio summarization](https://docs.speech.palatine.ru/api-reference/ai-service/ai-service/summarize-file)

Generates a structured summary from audio/video (or from already available text). In addition to built-in scenarios such as `meeting_summary`, it supports `user_prompt` — you can provide a custom prompt for the LLM to produce output in the structure you need (bullet points, decisions and action items, risks, Q&A, etc.).

## Installation

1. In your n8n instance, go to **Settings > Community Nodes → Install**
2. Enter: `n8n-nodes-palatine-speech`
3. Click **Install**
> ⚠️ Make sure the environment variable `N8N_COMMUNITY_PACKAGES_ENABLED=true` is set.

## Credentials

1. Go to **Credentials → + Create**
2. Find **Palatine Speech API**
3. Fill in the fields:
  * **API Key** — available in your Palatine Speech dashboard
  * **Base URL** — default is `https://api.palatine.ru`

## Workflow Example

1. `Webhook` → Receive an audio file
2. `Config` → Configure parameters
3. `Palatine Speech` → Transcribe the file
4. `Create record` → Create a table record
5. `Telegram` → Send the result to a chat

![workflow example](https://github.com/palatine-vision/n8n-nodes-palatine-speech/blob/main/docs/assets/WorkflowExample.png)

## Use Cases

* **Meeting summaries** \
For meeting and interview recordings, it is recommended to use `Summarize` (`meeting_summary`): it produces a brief summary, a list of decisions, and group action items by owner and due date; the result can be sent to the team chat if needed. \
For non-standard requests, specify `Prompt` in `Summarize` and provide the required instruction, for example: "Additionally, structure the agreements by deadlines and owners."

* **Lecture/webinar notes** \
Session recording → `Transcribe` → generate a full transcript. \
Save the resulting text alongside the session materials.

* **Automatic subtitles for video** \
Extract the audio track → `Transcribe` + `Diarize` → convert the result to SRT/VTT and attach it to the video. \
`Transcribe` produces the transcript, while `Diarize` provides speaker segmentation for multi-speaker recordings.

* **Customer support assistant** \
Processing voice messages with `Sentiment Analysis` helps determine the emotional tone of the request. \
Based on the result, tickets can be created in the CRM and a priority can be assigned.

## Compatibility

This node was tested with n8n v1.39.1 and later.

## Useful Resources

* [Palatine Speech documentation](https://docs.speech.palatine.ru/documentation/quick_start/transcription)
* [n8n Community Nodes guide](https://docs.n8n.io/integrations/community-nodes/)
* [Official n8n GitHub](https://github.com/n8n-io/n8n)

## Keywords

`n8n-community-node-package`, `n8n`, `palatine`, `speech-to-text`, `transcribe`, `transcription`, `stt`, `audio`, `ai`, `automation`, `voice-to-text`, `speech-recognition`, `audio-transcription`, `audio2text`, `audio-processing`, `diarization`, `speaker-diarization`, `speaker-segmentation`, `summarization`, `audio-summarization`, `sentiment-analysis`, `emotion-detection`, `tone-analysis`

## License
MIT

## Support
Need help? Contact our Telegram support bot: [@Speech_Palatine_Support_Bot](https://t.me/Speech_Palatine_Support_Bot)
