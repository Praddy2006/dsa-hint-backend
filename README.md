# DSA Hint Assistant — Backend

REST API backend for the DSA Hint Assistant Chrome extension. Handles authentication, session management, struggle score calculation, and AI-powered hint generation via Groq.

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Create account, returns JWT |
| POST | `/auth/login` | Login, returns JWT |
| POST | `/hint` | Stream a hint for the current problem |
| POST | `/hint/analyze` | Analyze complexity + detect DSA pattern |
| GET | `/hint/stats` | Fetch user's problem history and pattern breakdown |
| GET | `/health` | Health check |

## Tech Stack

- **Runtime** — Node.js
- **Framework** — Express
- **Database** — MySQL with mysql2 connection pool
- **Auth** — JWT (jsonwebtoken) + bcrypt password hashing
- **AI** — Groq API running LLaMA 3.3 70B
- **Streaming** — Server-Sent Events (SSE)
- **Deployment** — Railway

## Database Schema

```sql
users
  id, email, password_hash, created_at

sessions
  id, user_id, problem_slug, problem_title,
  hints_requested, wrong_submissions,
  time_spent_seconds, solved, created_at, updated_at

problem_stats
  id, user_id, problem_slug, struggle_score,
  pattern_tag, last_attempted, total_attempts
```

## Struggle Score Formula

```
score = (wrong_submissions × 2) + (hints_requested × 3) + (time_minutes / 10)
```

A higher score means more difficulty on that problem. Stored per user per problem and shown in the extension's stats panel.

## Hint Levels

The `/hint` endpoint accepts a `hintLevel` (1, 2, or 3) which controls the system prompt:

- **Level 1** — One question that surfaces the inefficiency. No algorithm names.
- **Level 2** — Conceptual nudge toward the solution category. No explicit algorithm.
- **Level 3** — Near-explicit hint. May name the algorithm. Never writes code.

## Pattern Tags

The `/hint/analyze` endpoint classifies problems into one of: `array`, `string`, `hashmap`, `two-pointers`, `sliding-window`, `binary-search`, `linked-list`, `stack`, `queue`, `tree`, `graph`, `dynamic-programming`, `greedy`, `recursion`, `backtracking`, `heap`, `trie`, `math`

## Environment Variables

```
PORT=3000
MYSQL_HOST=your_mysql_host
MYSQL_USER=your_mysql_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=your_database_name
JWT_SECRET=your_jwt_secret
GROQ_API_KEY=your_groq_api_key
```

See `.env.example` for the full template.

## Local Setup

```bash
npm install
node server.js
```

Create a MySQL database called `dsa_hint` and run the table creation SQL from the schema above before starting.

## Extension Repo

[dsa-hint-extension](https://github.com/Praddy2006/dsa-hint-extension)
