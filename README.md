# StatsFM Discord Widget

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install deps: `npm install`
3. Generate Prisma client: `npx prisma generate`
4. Start dev server: `npm run dev`

## Setting up Discord Application
1. Create a new application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy application ID and past it in [import-widget.js](./import-widget.js) at the top of the file.
3. Copy content of [import-widget.js](./import-widget.js) and paste it in the browser console on the Discord Developer Portal page for your application.
	* Sometimes browser console may not allow pasting, if you have issues while pasting, write `allow pasting` in the console and press enter, then try pasting again.
4. Setup application and authorize it on your account.

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
3. Bot asks user to connect their Discord account to stats.fm and click **Check connection**.
4. After successful check, account is linked in DB.
5. User can run `/refresh` manually (1h cooldown), and scheduled refresh runs every hour.

### Run locally with Docker Compose

```bash
docker compose up -d --build
```
