# statsfmwidget

Fastify + Prisma app that works as a **Discord HTTP interactions bot** (no websocket gateway) for linking stats.fm accounts and refreshing Discord metadata.

## Features

- Discord interactions endpoint (`POST /interactions`) with Ed25519 signature verification
- Slash commands:
	- `/login` -> starts Discord OAuth flow
	- `/link username:<value>` -> shows linking instructions and button to verify connection
	- `/refresh` -> manual refresh with 1h cooldown (configurable)
- Button flow for connection check:
	- User adds Discord user ID to stats.fm bio
	- Clicks **Check connection** button
	- Bot verifies bio and links account
- Automatic hourly refresh for all active users
- Prometheus metrics endpoint (`GET /metrics`)
- Prisma + SQLite persistence

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install deps: `npm install`
3. Generate Prisma client: `npx prisma generate`
4. Start dev server: `npm run dev`

## Required Discord Config

- Set in `.env`:
	- `DISCORD_PUBLIC_KEY`
	- `DISCORD_CLIENT_ID`
	- `DISCORD_CLIENT_SECRET`
	- `DISCORD_REDIRECT_URI`
	- `DISCORD_BOT_TOKEN`
- In Discord Developer Portal:
	- Add `DISCORD_REDIRECT_URI` to OAuth2 Redirects
	- Configure Interactions Endpoint URL to your deployed `/interactions` URL

## Register Slash Commands

Use:

- `POST /bot/register-commands`
- Header: `x-admin-token: <ADMIN_TOKEN>`

This registers `/login`, `/link`, and `/refresh` globally for your application.

## Command Flow

1. User runs `/login` and completes OAuth in browser.
2. User runs `/link username:XYZ`.
3. Bot asks user to add their Discord ID to stats.fm bio and click **Check connection**.
4. After successful check, account is linked in DB.
5. User can run `/refresh` manually (1h cooldown), and scheduled refresh runs every hour.

## Notes

- stats.fm side uses `@statsfm/statsfm.js`.
- The bot updates metadata using configured Discord API values in `.env`.

## Docker / Portainer

This repo includes:

- `Dockerfile`
- `docker-compose.yml`

Compose service details:

- Publishes `3000:3000`
- Loads variables from `.env`
- Persists SQLite DB in named volume mounted at `/app/prisma/data`
- Runs `prisma migrate deploy` automatically before starting the app
- Overrides `DATABASE_URL` in compose to `file:./prisma/data/dev.db`

### Run locally with Docker Compose

```bash
docker compose up -d --build
```

### Use in Portainer (Stacks)

1. Create a new Stack.
2. Paste the contents of `docker-compose.yml`.
3. Ensure your `.env` variables are provided (via env file bind or Portainer env vars).
4. Deploy the stack.

If you do not map `./prisma:/app/prisma`, your SQLite DB will be ephemeral.
If you remove the named volume mapping, your SQLite DB will be ephemeral.
