export const CLI_HELP=`zinin — обзор и управление работой
  zinin ps                              обзор Мака и newa
  zinin ps show <имя|id>                 подробности одной сессии
  zinin ps --watch [N]                   обновляемый обзор; Ctrl-C — выход
  zinin work                            управление в терминале (TUI)
  zinin work init [--journal FILE]       создать локальный журнал
  zinin work session --goal TEXT        создать управляемую сессию
  zinin work task --session ID --goal TEXT --criteria TEXT  поставить задачу
  zinin work run --task ID --engine local-demo|kimi         явный запуск
  zinin work status [--json]             дерево, результаты и команды приёмки
  zinin work accept --result ID --revision N --digest HASH  принять результат
  zinin work stop --run ID               остановить только свой процесс
  zinin work reconcile --run ID --as lost|finished-unknown --reason TEXT [--confirm]
                                        восстановление: ручная сверка, без kill
  zinin work run --task ID --engine ENGINE --attempt N      новая попытка после сверки
  zinin work history --task ID           история попыток, сверок и приёмок
  zinin work export --journal FILE --out FILE.jsonl         экспорт без изменения журнала
  zinin work status --remote newa        удалённый журнал, только чтение
  zinin --version                       версия, git и дата сборки
  zinin --banner                        показать встроенный баннер
  zinin                                 чат (отдельный режим)
Подробности: zinin ps --help / zinin work --help`;
