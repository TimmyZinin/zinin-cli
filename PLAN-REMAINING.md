# Zinin: оставшаяся работа — 05.10.2026

Статус: план предложен S0; код не изменён. Реализация этапа 1 требует
квитанции на Jev packet threshold 0.8 в TO-S0.md.

Цель: на Маке одной командой `zinin ps` видеть все живые сессии Мака и newa,
понятную текущую задачу, ожидаемые решения и последние сдачи.

## Основание и проверка

База: e3-session-overview-v3, ec0c401f487f6498eb5beb652d01e60734577c49.
Изучены README, документы E1/E2, тесты и код обзора, открытые PR/issues.
**Канонических PRD, ARCHITECTURE, CONTRACTS, ORCHESTRATION, ACCEPTANCE,
TUI.md в клоне нет**, хотя код и docs на них ссылаются. В docs ветки E2
PRD тоже отсутствует. Таблица покрывает доступные обещания; полноту сверки
с отсутствующим PRD не заявляем. S0 требуется передать канонические документы
или разрешённый путь. Чужие рабочие каталоги не исследовались.

GitHub API на 05.10:

- [PR #2](https://github.com/TimmyZinin/zinin-cli/pull/2): open, draft, E1 → main.
- [PR #3](https://github.com/TimmyZinin/zinin-cli/pull/3): open, **не draft**, E2 → E1.
- [PR #5](https://github.com/TimmyZinin/zinin-cli/pull/5): open, draft, E3 → E2.
- [Issue #1](https://github.com/TimmyZinin/zinin-cli/issues/1): open, падение
  установленного macOS Intel бинаря при поиске шрифта figlet.

Описание PR #5 устарело относительно HEAD: `/dev/ttysNNN`, версия remote,
числовой порядок ID окон и расширенные маркеры сдачи уже исправлены в коде
и покрыты тестами. Повторно реализовывать их не нужно.

На newa выполнено `../.tools/bun test`: **175/175**, 588 assertions,
23 файла, 0 ошибок; core 42, protocol 10, tui 13, sessions 110.
Полный лог: `../baseline-tests.log`. Runtime Bun 1.3.0 соответствует
package.json, локально скачан из официального GitHub release, SHA256 архива
сверён с SHASUMS256.txt:
`60c39d92b8bd090627524c98b3012f0c08dc89024cfdaa7c9c98cb5fd4359376`.
Глобальная установка и runtime чужих workers не использовались.
Справка psMain(["--help"]) проверена прямым импортом src/ps.ts.
Полный живой сбор newa не запускался: текущий collector обходит чужие
/home/agents/work/*; это запрещено поручением. Живая проверка Мака не проведена.

Отдельно воспроизведено: running/live=true + свежее время хода + текущий
TO-S0 «Вопрос: требуется решение по новой задаче» + REPORT старого хода
«## Прошлый ход — ГОТОВО» дают **state=done и needs≠null**.
Запуск parseNewaDir + applyDerivedStates на синтетическом входе подтверждает:
старая сдача скрывает текущую работу/решение даже при зелёных 175 тестах.

## Обещано → проверено → осталось

Номера R взяты только из прямых ссылок кода/PR. Тест означает локальный
прогон, а не живую приёмку Мака. Исторические measurements заново не запускались.

| Обещано в PRD / доступном источнике | Уже есть, проверено запуском/тестом | Осталось и место проверки |
|---|---|---|
| Полная спецификация | Есть E1 ADR/handoff и E2 performance report; PRD отсутствует | Получить от S0; дополнить трассировку требований, не объявлять полный PRD закрытым |
| Одна команда Mac + newa, README E3 | 110 sessions-тестов: парсеры, merge, таблица/JSON, версии, конфиг | Интеграционный collector smoke на newa; совмещённый живой запуск на Маке |
| Все живые сессии | Окна Terminal, tmux, workdir поддержаны | Collector читает только selected tab окна, остальные вкладки теряет. Workdir показывает и старые каталоги. Стабильный ID вкладки и отдельная живость; raw fixtures на newa, окна на Маке |
| Понятная текущая задача | Заголовок окна / первая строка TASK*.md; отсутствие TASK протестировано как null | Разделить текущую задачу и прошлую сдачу; полное описание в деталях; при отсутствии данных «задача не указана», без выдуманного пересказа |
| Что ждёт решения | needs/waiting-tim протестированы | Исправить воспроизведённый конфликт done/needs; не терять вопрос после подписи; источник и свежесть сигнала, отдельный список решений |
| Что сдано | Маркеры ГОТОВО/СДАНО, отрицания и вопросы покрыты тестами | Отдельное поле последней сдачи с доказательством; не равнять сдачу остановке сессии, приёмке человеком или окончанию следующей задачи |
| Ошибки/лимиты/простой | Пороги, проценты, transcript errors, mtime, cwd/tty fallback проходят | README расходится с кодом: сырой 403 не даёт limit, ✳ сам по себе не working. Связь двух активных окон одного проекта с transcript без session ID остаётся эвристикой |
| Обзор переживает отказ источника | Malformed parser inputs и недоступная машина покрыты | Полный таймаут SSH/osascript, exit code, remote JSON validation, последовательный watch без наложения сборов, остановка собственных collector children |
| R06: задача → доказательство → приёмка → сохранение | journal/cycle/tui app тесты проходят | Подключить к поставляемому entrypoint: repl сейчас не подключает TuiApp/LocalExecutor; живой цикл движка отдельно |
| R07: продолжение движка | KimiEngine сохраняет provider session ID, canned transport тестируется | Настоящее resume и compatibility receipts; Codex/Claude adapters. Сохранение ID само не доказывает продолжение |
| R08/R19: доставка/идемпотентность | broker/journal: epoch, dedup, rollback, restart проходят | broker явно offline spike; production transport, reconciliation и интеграция исполнителя |
| Один писатель, аренды, остановка | leases/supervisor: SIGTERM/SIGKILL собственных тестовых children проходят | Реальные providers и process ownership; follow-up PR #3 об active session close и неизвестном run |
| R11: отдельное разрешение внешнего действия | Одноразовый approval покрыт leases tests | Коллизия approval_id в одну миллисекунду из PR #3; привязка к реальному действию и UI; приёмка результата не заменяет permission |
| R17/TUI A–F, дерево до 7 сессий | 13 tui-тестов, layout/selection/task/accept/render diff | Entry point, реальные сессии, persistent drafts, help и полный keyboard/paste contract |
| E2-R03: история и bounded cache | history/paging: 2000 строк, 16KiB preview, 1MiB cache, поиск/recovery проходят | Экспорт и реальный поток; история сохраняется. Старое утверждение handoff об отсутствии cache уже не соответствует HEAD |
| R20: telemetry/budgets | 4 protocol telemetry tests; E3 извлекает доступные проценты | Реальные источники всех движков, budget enforcement, session/compaction epoch; неизвестное явно обозначать |
| E2-R01/R02: отзывчивость | Исторический report об улучшении TS/7; unit suite зелёный | Benchmarks не повторены. TS/3 after в report 9/10 ниже 50ms; production acceptance не закрыта. Event lag/slow output/реальные 3 и 7 сессий |
| E2-R04/R06: native UX | Linux fixture/PTY опыт описан в docs | IME, Terminal resize, screen reader, colors/motion, canonical assets; обязательна живая матрица Мака |
| Установка одним бинарём; issue #1 | ps обходит баннер лениво; help работает | Clean build/install, embedding fonts/assets и platform smoke; issue #1 требует именно macOS Intel бинарь |

## Порядок реализации

### Этап 1 / E4 — рабочий обзор для владельца

Предлагаемая ветка: e4-session-overview-actionable от указанного E3 HEAD.
Draft PR base: e3-session-overview-v3, чтобы diff содержал только этот этап.
Сначала квитанция S0/Jev на предложенное изменение правил состояний.

1. Выделить collector dependencies; для тестов явный work root/список worker,
   без обхода чужих каталогов. Конечные таймауты, диагностика источников,
   проверка remote payload и последовательный watch.
2. Разделить живость, текущую деятельность, ожидаемое решение и последнюю
   сдачу. Источник и время сигнала либо «время неизвестно». Старая сдача
   сохраняется, но не подавляет новый ход/вопрос. Наличие каталога или
   attached tmux само не доказывает живого исполнителя.
3. Все вкладки Terminal со стабильным ID. Фикстуры повторяют сырой osascript:
   ASCII 9/30, boolean, `/dev/ttysNNN`, пустой tty, многострочный экран.
   Только вымышленные имена/пути/заголовки. Две вкладки одного проекта,
   cd после запуска, interpreter wrappers, отсутствие lsof.
4. Читаемый обзор «работают / ждут решения / последние сдачи», машина и
   понятная задача. Полные вопрос/результат и доказательство в деталях.
   Живая сессия с прошлой сдачей остаётся видимой. Сохранить --json и старые
   поля, новые сведения добавлять совместимо; неизвестное не угадывать.
5. README: единая команда на Маке, стабильный newa checkout через ps config,
   версии обеих сторон; синхронизировать таблицу состояний с кодом.
   Установка в production и изменение контроллера сюда не входят.

Сдача на newa: baseline плюс регрессии нового вопроса/хода после done,
live=false/unknown, пустого TASK, нескольких вкладок, raw tty, таймаутов,
повреждённого remote JSON, отказа одного источника, watch/Ctrl-C.
Интеграционный CLI smoke на изолированных синтетических источниках.
Реальное N/N записать после запуска; фикстуры не считать живым Mac evidence.
Контроллер, inbox/turns/meta/status/STOP не изменять.

S0 на Маке проверяет: несколько окон/вкладок, одинаковый проект, смену cwd,
работу/ожидание/сдачу, закрытую вкладку, недоступную newa, зависший collector,
Ctrl-C watch. Каждую строку сверить с фактом и версиями двух checkout.
Без этой проверки не объявлять полноту «все живые сессии» доказанной.

GIT_AUTHOR_NAME/GIT_COMMITTER_NAME=newa, нейтральный email; обычный push
новой ветки и draft PR. Force push и переписывание истории запрещены.
Push/PR уже разрешены поручением; дополнительное разрешение не требуется.
Однако README окружения описывает read-only deploy key, gh отсутствует в
PATH, write credential не проверен. При фактическом отказе — один отчёт S0,
без чтения auth/config, создания доступов или повторных попыток через обход.

### Этап 2 / E5 — управление работой

Подключить TUI/journal/executor к entrypoint; task/accept/resume/stop с точной
адресацией сессии. Kimi/Codex/Claude adapters, capability receipts и отдельно
согласованные живые проверки. Закрыть follow-up PR #3: approval_id и политику
закрытия активной сессии. newa: deterministic tests/PTY; native UX: Мак.

### Этап 3 / E6 — оркестрация и восстановление

Production broker/transport, durable receipts, reconciliation, restart без
повторной внешней отправки, восстановление drafts, экспорт истории,
реальная telemetry R20 и budgets. newa: offline/crash/fault tests;
межмашинный transport/provider semantics: отдельная живая приёмка.

### Этап 4 / E7 — эксплуатационная готовность

Закрыть canonical PRD/acceptance matrix, performance 3/7 реальных сессий и
slow terminal, ввод/IME/accessibility, packaging и issue #1. Мак обязателен.
Решение о слиянии/релизе/deployment остаётся у S0/владельца.

После реализации этапа 1, тестов, обычного push и draft PR остановиться;
этапы 2–4 автоматически не начинать.
