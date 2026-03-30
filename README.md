# llm-battle

**Upload a UI screenshot. Watch every major LLM race to recreate it.**

llm-battle is an open-source benchmarking tool that sends the same UI screenshot to multiple large language models simultaneously and streams their HTML reconstructions back in real time — so you can compare quality, speed, and cost side-by-side.

---

## Features

- **Multi-model comparison** — query up to 12 models at once (GPT, Claude, Gemini, Qwen, and more via Vercel AI Gateway)
- **Live streaming** — watch each model generate HTML token-by-token with live latency and token counters
- **Instant preview** — rendered HTML previews alongside raw code, switchable per model
- **Cost breakdown** — per-model cost estimates based on input/output/cache token pricing
- **Performance metrics** — time-to-first-token and total runtime for every model
- **Run history** — sign in with GitHub to save runs and revisit past comparisons
- **Draft persistence** — unsubmitted runs are saved to localStorage and restored on reload

---

## Tech Stack

| Layer | Technology |
| ------- | ----------- |
| Framework | Next.js 16 + React 19 |
| Styling | Tailwind CSS 4 |
| Language | TypeScript |
| Models | Vercel AI Gateway (OpenAI-compatible) |
| Streaming | Vercel AI SDK (`ai` v6) |
| Database | Neon Postgres (serverless) |
| Auth | Better Auth + GitHub OAuth |
| Storage | Tigris (S3-compatible) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) (enforced — npm/yarn not supported)
- A [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) API key
- A [Neon](https://neon.tech) Postgres database

### 1. Clone and install

```bash
git clone git@github.com:justsml/llm-battle.git
cd llm-battle
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Required
BETTER_AUTH_URL=http://localhost:4004
BETTER_AUTH_SECRET=<openssl rand -hex 32>
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Optional — GitHub OAuth (enables run history)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional — Tigris storage (for persisting screenshots + outputs)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT_URL_S3=
AWS_REGION=auto
TIGRIS_BUCKET=
```

If you created the bucket with `fly storage create`, Fly usually injects `BUCKET_NAME` for you. This app accepts either `TIGRIS_BUCKET` or `BUCKET_NAME`.

> **GitHub OAuth callback URL:** `http://localhost:4004/api/auth/callback/github`

### 3. Run the dev server

```bash
pnpm dev
```

Open [http://localhost:4004](http://localhost:4004).

---

## How It Works

1. **Upload** a screenshot of any UI — a website, mobile screen, design mockup, anything
2. **Select models** — pick 2–12 models from the available vision-capable models
3. **Run** — the app sends your screenshot and a reconstruction prompt to all selected models in parallel
4. **Compare** — watch outputs stream in real time; toggle between rendered preview and raw HTML per model
5. **Save** — sign in with GitHub to persist runs and browse history

### API Routes

| Route | Method | Description |
| ------- | -------- | ------------- |
| `/api/compare` | `POST` | Streams model results as newline-delimited JSON (SSE) |
| `/api/models` | `GET` | Lists available vision models (cached 1 hour) |
| `/api/runs` | `GET` | Returns authenticated user's saved runs |
| `/api/auth/*` | `*` | Better Auth endpoints |

---

## Project Structure

```text
src/
├── app/
│   ├── api/
│   │   ├── auth/[...all]/   # Better Auth handler
│   │   ├── compare/         # Streaming multi-model inference
│   │   ├── models/          # Available model list
│   │   └── runs/            # Run history (authenticated)
│   ├── globals.css          # Tailwind + custom dark theme
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── build-off-client.tsx # Main UI component
└── lib/
    ├── auth.ts              # Better Auth server config
    ├── auth-client.ts       # Client-side auth helpers
    ├── db.ts                # Neon schema + Kysely queries
    ├── gateway-models.ts    # Model fetching + cost calculation
    ├── models.ts            # Default model list + system prompt
    ├── storage.ts           # S3/Tigris upload helpers
    ├── types.ts             # Shared TypeScript types
    └── utils.ts             # Utilities (cn, readDataUrlMeta)
```

---

## Database Schema

The app uses two tables in Neon Postgres:

**`runs`** — one row per comparison run

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | uuid | Primary key |
| `user_id` | text | GitHub user (nullable for anonymous) |
| `prompt` | text | The prompt sent to all models |
| `screenshot_url` | text | Stored screenshot URL |
| `status` | text | `pending`, `running`, `complete`, `error` |
| `created_at` | timestamptz | Run timestamp |

**`run_model_results`** — one row per model per run

| Column | Type | Description |
| -------- | ------ | ------------- |
| `run_id` | uuid | FK to `runs` |
| `model_id` | text | Model identifier |

**`custom_model_configs`** — saved custom LLM endpoints per user

| Column | Type | Description |
| --- | --- | --- |
| `id` | text | Primary key |
| `user_id` | text | Owning user |
| `name` | text | Friendly display name |
| `llm_string` | text | Stored `llm://...` connection string |
| `supports_image_input` | boolean | Whether the backend can accept screenshots |

### Custom model configs

You can now save user-scoped custom backends through `POST /api/models` and remove them with `DELETE /api/models?id=<id>`. Saved entries are merged into the normal `/api/models` catalog for signed-in users.

Example LM Studio config:

```json
{
  "name": "Local LM Studio",
  "llmString": "llm://localhost:1234/qwen2.5-vl-7b-instruct?protocol=http",
  "supportsImageInput": true
}
```

Custom backends are treated as OpenAI-compatible endpoints. Local hosts default to `http://` and `/v1`; you can override the path with `?path=/custom/v1`.
| `output` | text | Generated HTML |
| `input_tokens` | int | Prompt token count |
| `output_tokens` | int | Completion token count |
| `cost_usd` | numeric | Estimated cost |
| `first_token_ms` | int | Time to first token (ms) |
| `runtime_ms` | int | Total generation time (ms) |

---

## Development

```bash
pnpm dev      # Start dev server with hot reload
pnpm build    # Production build
pnpm start    # Start production server
pnpm lint     # Run ESLint
```

---

## License

MIT
