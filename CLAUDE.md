# itmo-ext — баллы из таблиц в зачётке my.itmo.ru

Расширение Chrome (Manifest V3, без сборки и зависимостей): дописывает в «Зачётку»
`https://my.itmo.ru/points` баллы из публичного API `https://m3105.ru/api/v1/grades`.
Для людей — [README.md](README.md).

## Структура

```
manifest.json         MV3: storage, host_permissions m3105.ru и my.itmo.ru
src/background.js     service worker (ES-модуль): загрузка всех таблиц, кеш 10 мин, поиск строки
src/shared.js         DEFAULT_SETTINGS, normalizeName — общее для фона и попапа
src/bridge.js         content script, изолированный мир: CustomEvent ↔ runtime.sendMessage
src/page.js           content script, world: MAIN: правка Vuex-стора зачётки и плашки
popup/                настройки (chrome.storage.sync → settings)
icons/                иконки 16/32/48/128: кольцо баллов с плюсом на синем градиенте
test/harness.html     макет стора с модулем зачётки; test/fixture.json — обезличенный ответ getGrades
```

## Как устроено

- **Поток данных**: `page.js` ждёт `window.$nuxt.$store` и шлёт `m3105:hello` с
  `{ identity: { fullName } }` (`$auth.user.family_name` + `given_name`). `bridge.js` пересылает
  это в фон (`{ type: 'getGrades', identity, force }`), ответ возвращает событием
  `m3105:grades`. Между мирами ходят только JSON-строки в `detail`.
- **Хранилище**: `storage.sync.settings` — `{ enabled, mode: 'max' | 'table', nameOverride,
  groupOverride }`; `storage.local.cache` — `{ fetchedAt, sources: [{ source, rows }] }`;
  `storage.local.identity` — последнее имя со страницы. Изменение `settings` или `cache`
  заставляет `bridge.js` перезапросить баллы, и страница перерисовывается без перезагрузки.
- **Поиск строки** (`findRow`): сначала `row.me` (кука m3105.ru, запрос с
  `credentials: 'include'`), потом совпадение нормализованного «Фамилия Имя» (ё→е, регистр,
  пунктуация), при тёзках — фильтр по группе (латинская M → кириллическая М). Сводный
  рейтинг потока (`id < 0`, `stream`) пропускается.
- **Стор зачётки** — Vuex-модуль `modules/points/points` (ключ в `store.state` — строка
  целиком). `SET_DISCIPLINES` группирует записи по `discipline_id` в массивы
  `current_score[]`, `rate[]`, `control_type[]`…; `SET_DETAILS` пишет
  `details[est_id] = [{ id, parent_id, control_name, lower_value, max_value, rate, date,
  teacher, required, min_value }]` **без реактивности**, поэтому после правки `page.js`
  переприсваивает `st.details = { ...details }`. Виджет на главной —
  `widgetDisciplines`, там `current_score` — число.
- **Правка** идёт в `store.subscribe` синхронно после мутаций модуля, до отрисовки.
  Исходное значение хранится под `Symbol` (`META`) на объекте предмета, поэтому выключение
  и смена режима возвращают официальные баллы. Строки таблицы в деталях — с `id`
  `m3105-<sourceId>[-<key>]`, при каждом применении снимаются и строятся заново.
- **Порядок вложенных строк**: `ListItem.details` на my.itmo.ru собирает дерево с ошибкой
  (после вложенной строки пропускает следующую), дети выходят вперемешку. `itmoTree` —
  копия этого алгоритма, `arrangeForTree` подбирает перестановку, после которой порядок
  правильный. Меняют алгоритм на сайте — меняй копию.
- **Только текущий семестр**: `plans[].semesters[].actual` для `currentPlan` и
  `currentSemester`.
- **Предмет ↔ таблица**: нормализованное `subjectName` или `title` источника равно названию
  дисциплины, иначе вхождение одного в другое (от 6 символов).

## Проверка

- Синтаксис: `for f in src/*.js popup/*.js; do node --check "$f"; done`.
- `page.js` без входа в ИСУ: `python3 -m http.server 8765` и
  `http://localhost:8765/test/harness.html`. Макет не реактивный: после событий вызывай
  `render()` и смотри `$nuxt.$store.state['modules/points/points']`.
- Живая страница: перезагрузить расширение в `chrome://extensions` и открыть
  my.itmo.ru/points. Скрипты с localhost CSP сайта не пускает.

## Правила

- Без сборщиков и npm-зависимостей: файлы грузятся в Chrome как есть.
- Код — современный JS (async/await, `??`, optional chaining), 2 пробела, одинарные кавычки.
  Комментарии — только там, где без них не понять (как с порядком дерева).
- Новые разрешения в `manifest.json` — только по делу. Хосты — только m3105.ru и
  my.itmo.ru.
- Ничего не отправлять на сторонние серверы. Имя студента остаётся в браузере.
- Не коммитить реальные баллы и ФИО: фикстуры обезличены.
- Коммиты — Conventional Commits, коротко и по-русски: `feat(popup): …`, `fix: …`.
