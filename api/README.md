# Oxygen Dispatcher API

Laravel stores private research experiments and provides optional explanations of saved results. It does not run the oxygen controller, prescribe treatment, independently recompute submitted experiments, or control hardware.

## Local setup

Use PHP and extensions compatible with `composer.lock`, Composer, and a supported database. Check the actual runtime with `php -v`, `composer check-platform-reqs`, and `php -m`. SQLite is convenient for a new local workspace; PostgreSQL is also supported through Laravel configuration.

From `api/`:

```powershell
composer install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
php artisan key:generate
```

Only generate an application key for a new installation; retain the existing key and database settings for an established environment. For a new SQLite setup, set `DB_CONNECTION=sqlite`, enable the PDO SQLite extension, and create the database file if needed:

```powershell
if (!(Test-Path database/database.sqlite)) { New-Item -ItemType File database/database.sqlite }
php artisan migrate
php artisan serve
```

For PostgreSQL, set `DB_CONNECTION=pgsql` and the `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD` values before migration. Do not overwrite an existing `.env`.

The additive migration `2026_11_04_000001_add_research_provenance_to_runs.php` adds ownership, client identifiers, provenance, configuration and history fields. Existing runs remain intact, marked legacy and unowned. They are not exposed to arbitrary signed-in users and are not interpreted as current-model results. Historical ownership recovery requires a deliberate administrator process; it is not guessed from existing data.

The refactor did not migrate an existing project database. Apply the migration in the intended environment before private saving.

## Access tokens and ownership

Provision a research token from a trusted terminal:

```powershell
php artisan research:token researcher@example.test --name="Researcher"
```

The command creates or finds the account, issues a token with the `research` ability and a 30-day expiry, and prints that token once. Paste it into **Saved runs** in the research workspace. The frontend stores it in `sessionStorage` for that tab session. Keep it out of source control and shared logs. Issuing a replacement with `--revoke` revokes that user's existing tokens; use that option deliberately.

All `/api/runs` and `/api/ai/*` routes require bearer authentication and the research ability. Each lookup is scoped to the authenticated owner. Listing returns the latest 50 owned runs. The general limit is 60 requests/minute, with save and AI routes additionally limited to 10/minute. Request bodies are bounded at 8 MiB. CORS permits the configured frontend origins; it is not an authentication substitute.

## API contract

- `POST /api/runs`: save a completed current-schema experiment. Stable `client_run_id` plus owner defines identity. The same validated payload returns the existing row; a different payload reusing that identity returns HTTP 409.
- `GET /api/runs`: list recent owned records.
- `GET /api/runs/{id}`: retrieve a full owned record.
- `POST /api/ai/handover`: `{run_id}`, returns `{note, source, reason}`.
- `POST /api/ai/ask`: `{run_id, question}`, returns `{answer, source, reason}`.
- `POST /api/ai/explain-event`: `{run_id, event_id}`, returns `{explanation, source, reason}`. The event identifier is stable within the run; it is not an array index.
- `POST /api/ai/replay`: subject, view, action, and selected time window, plus an event ID for explanations or a question for Ask. Returns text and source evidence from that window. Laravel reads the prepared recordings and evidence in `web/public/replay/`. If the API is deployed separately, set `REPLAY_DATA_DIRECTORY` to a local copy of that same directory.

`StoreRunRequest` validates configuration bounds, nested finite values, identifiers, history sizes, source gas arithmetic, coverage categories and timestamps. Saved data includes actual duration, full resolved controller configuration, seed, faults, alarm lifecycle, event history, chart samples and internal schema/model/controller identifiers. Server validation checks structure and consistency. Provenance remains `client-submitted`; this is not independent scientific verification.

Legacy records cannot be explained with the current model. Record-not-found responses avoid disclosing another owner's data.

## Optional AI and trusted certificates

Core simulation, replay, local review and export do not depend on AI. Configure a provider only if explanations are wanted:

```dotenv
AI_PROVIDER=google
AI_API_KEY=
AI_MODEL=
AI_CA_BUNDLE=
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Supported adapters are `google`, `openai`, `anthropic`, `groq`, and `openrouter`. Set a model identifier supported by the selected provider; no provider key or model is required for deterministic template responses. Keys stay in the API environment.

For the replay assistant, configure `AI_PROVIDER=openai`, `AI_API_KEY`, and `AI_MODEL`. The backend also recognizes `OPENAI_API_KEY` and `OPENAI_MODEL` when the corresponding generic settings are absent. The configured OpenAI model selects evidence for the replay response. Laravel supplies the readings, times and text from that evidence.

The public `POST /api/ai/replay` uses only bundled BIDMC replay evidence and requires no research token. Its limits are 10 requests per minute per client IP, 30 per minute across the demo, and 500 per day across the demo. Use a persistent, shared cache when running more than one backend instance so these limits apply across the deployment.

TLS verification is enabled. If the PHP installation lacks a usable trust store, configure PHP's `curl.cainfo`/`openssl.cafile` or set `AI_CA_BUNDLE` to a readable trusted CA bundle. Do not disable certificate verification. Provider failures log only bounded provider/status metadata, never credentials or upstream response bodies.

Explanations use arithmetic-checked saved aggregates, original configuration, faults and selected events, including important early faults. All event/question text is treated as data. AI has no execution, record-update or delivery-control tools. Responses carry `source=ai` or `source=template` and an availability reason. Generated text still needs review against the source record; it is not treatment guidance.

## Tests

```powershell
php artisan test
```

Direct PHPUnit can be used where the Artisan subprocess is unavailable:

```powershell
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit
```

Omit the extension option if PDO SQLite is already enabled. Tests use an in-memory SQLite database and mocked HTTP provider responses. They cover authentication, token abilities, owner isolation, idempotency, deep validation, gas/coverage consistency, legacy preservation, stable event explanations, provider failure and early fault context. `tests/Fixtures/engine-run.json` is an actual TypeScript-engine export with a signal fault, used to check the frontend/backend contract.

See `../docs/refactor-progress.md` for checks executed in the refactor environment and any remaining environment limitations.
