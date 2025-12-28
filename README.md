![hat of ReadME](https://github.com/haxbxbdbhshs/Palatine-Speech-Node-n8n/blob/main/hat.png)

# n8n-nodes-palatine-speech

---

> Разработано для бесшовной интеграции **Palatine Speech API** в воркфлоу n8n.


Это community нода n8n, которая интегрирует [Palatine Speech](https://speech.palatine.ru/) в ваш воркфлоу n8n, предоставляя возможность обрабатывать аудио файлы: проводить транскрибацию, диаризацию, анализ тональности и суммаризацию напрямую в воркфлоу n8n — без необходимости вручную настраивать HTTP-запросы.

## Навигация

---
[Поддерживаемые задачи (Tasks)](#поддерживаемые-задачи-tasks)\
[Выбор модели](#выбор-модели)\
[Особенности](#особенности)\
[Установка](#установка)\
[Учётные данные (Credentials)](#учётные-данные-credentials)\
[Пример воркфлоу](#пример-воркфлоу)\
[Варианты использования](#варианты-использования) \
[Совместимость](#совместимость)\
[Полезные ресурсы](#полезные-ресурсы)\
[Ключевые слова](#ключевые-слова)


##  Поддерживаемые задачи (Tasks)

---
Подробнее о каждой задаче можно узнать из документации Palatine Speech, кликнув на ее название
* [Полный список поддерживаемых файлов доступе по ссылке](https://docs.speech.palatine.ru/documentation/technical_information/supported_files)
* [Полный список поддерживаемых языков доступе по ссылке](https://docs.speech.palatine.ru/documentation/technical_information/supported_languages)

###  [Transcribe — транскрибация речи](https://docs.speech.palatine.ru/documentation/quick_start/transcription)

Функция распознавания речи (Speech-to-Text, STT)


###  [Diarize — диаризация речи](https://docs.speech.palatine.ru/api-reference/diarization/diarization-polling-api/diarize)

Разметка аудио по спикерам и таймкодам

###  [Sentiment Analysis — анализ тональности](https://docs.speech.palatine.ru/documentation/quick_start/sentiment_analyze#sozdanie-zadachi)

Определяет эмоциональную окраску текста в аудио

###  [Summarize — пересказ аудио](https://docs.speech.palatine.ru/documentation/quick_start/summarization)

Нода предоставляет **саммери аудиофайлов** в различных форматах

####  Дополнительные параметры Summarize:

При выборе `Task = Summarize` становятся доступны дополнительные параметры:

**Thinking**:

Включает расширенный режим рассуждений модели

**AI Task**:

Определяет тип Суммаризации:

* `meeting_summary` - Автоматический пересказ совещания, интервью или звонка
* `user_prompt` - Пользователь сам задаёт инструкцию для пересказа или для получения необходимой информации из аудиофайла

## Выбор модели

---
В поле `model` есть возможность выбрать две модели, через которые будут выполняться задачи:\
  `palatine_small` — быстрая\
  `palatine_large_highspeed` — высокоточная


##  Особенности

---
Для задач `Diarize`, `Sentiment`, `Summarize` осуществляется двухэтапная работа ноды.

Алгоритм работы:

1. Нода отправляет задачу в Palatine Speech API
2. Получает `task_id`
3. Выполняет **polling статуса** (каждые 0.5 секунды)
4. Возвращает финальный результат после завершения обработки

## Установка

---
1. В вашем экземпляре n8n перейдите в **Settings → Community Nodes → Install new**
2. Введите: `n8n-nodes-palatine-speech`
3. Нажмите **Install**
> ⚠️ Убедитесь, что переменная окружения `N8N_COMMUNITY_NODES_ENABLED=true` установлена.



## Учётные данные (Credentials)

---
1. Перейдите в **Credentials → + Create**
2. Найдите **Palatine Speech API**
3. Заполните поля:
  * **API Key** — ваш токен из личного кабинета Palatine
  * **Base URL** — по умолчанию `https://api.palatine.ru` 
>  API-ключ можно найти в https://speech.palatine.ru/dashboard.


## Пример воркфлоу

---
1. `Webhook` → Получаем аудио файл
2. `Config` → Здесь основные параметры
3. `Palatine Speech` → Транскрибируем файл
4. `Create record` → Создаем запись в таблице
5. `Telegram` → Отправляем результат в чат

![workflow example](https://github.com/haxbxbdbhshs/Palatine-Speech-Node-n8n/blob/main/ExampleWorkflow.png)

## Варианты использования

---
* **Итоги по встречам** \
Для записей встреч/интервью используйте `Summarize` `(meeting_summary)` → получайте краткое резюме, решения и задачи → отправляйте в чат команды. \
Для нестандартных запросов добавьте в `Summarize` `Prompt` и задавайте инструкцию, например: “Дополнительно структурируй договорённости по срокам и ответственных”.

* **Конспекты лекций/вебинаров** \
Запись занятия → `Transcribe` → формируйте дословный конспект и сохраняйте в папку с занятием.

* **Авто-субтитры для видео**
Забирайте аудиодорожку → `Transcribe` + `Diarize` → конвертируйте результат в SRT/VTT и прикрепляйте к видео.

* **Помощник тех поддержки** \
Отправляйте голосовые сообщения → `Sentiment Analysis` → создавайте тикеты в CRM и проставляйте приоритет в зависимости от настроя сообщения пользователя.

## Совместимость

---
Эта нода была протестирована на версиях n8n ≥ 1.39.1

## Полезные ресурсы

---
* [Документация Palatine Speech](https://docs.speech.palatine.ru/documentation/quick_start/transcription)
* [Руководство по Community Nodes в n8n](https://docs.n8n.io/integrations/community-nodes/)
* [Официальный GitHub n8n](https://github.com/n8n-io/n8n)

## Ключевые слова

---
`n8n-community-node-package`, `n8n`, `palatine`, `speech-to-text`, `transcribation`, `stt`, `audio`, `ai`, `automation`, `voice-to-text`, `speech-recognition`, `audio-transcription`, `audio2text`, `audio-processing`, `diarization`, `speaker-diarization`, `speaker-segmentation`, `summarization`, `audio-summarization`, `sentiment-analysis`, `emotion-detection`, `tone-analysis`

