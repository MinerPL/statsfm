import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { verifyKey } from 'discord-interactions';
import { prisma } from './db';
import { env } from './config';
import { metricsText } from './metrics';
import { refreshAllUsers, refreshConnectedUser, syncConnectedUserMetrics } from './refresh';
import { patchDiscordProfileRemoved } from './services/discord-client';
import { verifyStatsFmBioContainsDiscordUserId } from './services/statsfm-link';

const app = Fastify({ logger: true });

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const EPHEMERAL_FLAG = 1 << 6;
const oauthStateStore = new Map<string, { createdAt: number; expectedDiscordUserId: string }>();

function toApiOrigin(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/api(?:\/v\d+)?\/?$/i, '');
}

function requireAdmin(requestToken: string | undefined): void {
  if (requestToken !== env.ADMIN_TOKEN) {
    throw new Error('Unauthorized');
  }
}

function requireDiscordOAuthConfig(): void {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
    throw new Error('Discord OAuth is not configured');
  }
}

function requireDiscordInteractionConfig(): void {
  if (!env.DISCORD_PUBLIC_KEY) {
    throw new Error('DISCORD_PUBLIC_KEY is not configured');
  }
}

function cleanupExpiredOauthState(): void {
  const now = Date.now();

  for (const [state, value] of oauthStateStore.entries()) {
    if (now - value.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStateStore.delete(state);
    }
  }
}

function createOauthUrl(discordUserId: string): string {
  requireDiscordOAuthConfig();
  cleanupExpiredOauthState();

  const state = randomUUID();
  oauthStateStore.set(state, {
    createdAt: Date.now(),
    expectedDiscordUserId: discordUserId
  });

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: env.DISCORD_REDIRECT_URI,
    scope: env.DISCORD_OAUTH_SCOPES,
    state
  });

  return `${toApiOrigin(env.DISCORD_API_BASE_URL)}/oauth2/authorize?integration_type=1&${params.toString()}`;
}

function interactionUserId(interaction: {
  member?: { user?: { id?: string } };
  user?: { id?: string };
}): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

async function verifyRequest(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  requireDiscordInteractionConfig();

  const signature = request.headers['x-signature-ed25519'];
  const timestamp = request.headers['x-signature-timestamp'];

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    reply.code(401).send({ error: 'Missing Discord signature headers' });
    return false;
  }

  const rawBody = JSON.stringify(request.body ?? {});
  const isValid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);

  if (!isValid) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

function discordResponse(content: string, components?: unknown[]) {
  return {
    type: 4,
    data: {
      content,
      flags: EPHEMERAL_FLAG,
      ...(components ? { components } : {})
    }
  };
}

function landingPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>stats.fm Discord Widget</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1115;
        --panel: rgba(18, 22, 31, 0.92);
        --panel-border: rgba(255, 255, 255, 0.08);
        --text: #f3f6fb;
        --muted: #a7b0c0;
        --accent: #7ee0c3;
        --accent-strong: #5bbfa1;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
        font-family: Inter, Segoe UI, system-ui, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top, rgba(126, 224, 195, 0.2), transparent 36%),
          radial-gradient(circle at bottom right, rgba(91, 191, 161, 0.18), transparent 30%),
          linear-gradient(180deg, #12151b 0%, var(--bg) 100%);
      }

      main {
        width: min(760px, 100%);
        padding: 40px;
        border: 1px solid var(--panel-border);
        border-radius: 28px;
        background: var(--panel);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(18px);
      }

      .eyebrow {
        margin: 0 0 14px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        font-size: 0.78rem;
        color: var(--accent);
      }

      h1 {
        margin: 0;
        font-size: clamp(2.2rem, 4vw, 4rem);
        line-height: 1.02;
      }

      p {
        margin: 18px 0 0;
        font-size: 1.04rem;
        line-height: 1.7;
        color: var(--muted);
      }

      .grid {
        display: grid;
        gap: 16px;
        margin-top: 28px;
      }

      .card {
        padding: 18px 20px;
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
      }

      .card strong {
        display: block;
        margin-bottom: 8px;
        color: var(--text);
        font-size: 1rem;
      }

      a {
        color: var(--accent);
        text-decoration: none;
      }

      a:hover {
        color: var(--accent-strong);
        text-decoration: underline;
      }

      .footer {
        margin-top: 28px;
        font-size: 0.95rem;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">stats.fm Discord Widget</p>
      <h1>Discord has restricted custom widgets you do not own.</h1>
      <p>
        This page explains the change and points to the self-hosted version of this project for anyone who wants to run it themselves.
      </p>

      <div class="grid">
        <div class="card">
          <strong>What changed</strong>
          <div>
            Discord no longer lets you add application widgets to your profile board unless you own the application or belong to the owning team with developer access.
            Existing widgets can still remain visible and keep updating metadata, but you cannot re-add them after removing them.
          </div>
        </div>

        <div class="card">
          <strong>Self-hosting</strong>
          <div>
            If you want to host this yourself, use this repository: <a href="https://github.com/MinerPL/statsfm" rel="noreferrer noopener" target="_blank">github.com/MinerPL/statsfm</a>
          </div>
        </div>

        <div class="card">
          <strong>Source</strong>
          <div>
            This update comes from a message by BigNutty on the Discord Previews server.
          </div>
        </div>
      </div>

      <p class="footer">
        As of <time datetime="2026-04-03T00:30:00Z">April 3, 2026</time>, the new restriction applies to custom widgets added to profile boards.
      </p>
    </main>
  </body>
</html>`;
}

app.get('/', async (_request, reply) => {
  reply.header('content-type', 'text/html; charset=utf-8');
  return reply.send(landingPageHtml());
});

async function sendDmInstruction(discordUserId: string): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    return;
  }

  const baseUrl = toApiOrigin(env.DISCORD_API_BASE_URL);
  const authHeader = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };

  const dmResponse = await fetch(`${baseUrl}/api/v10/users/@me/channels`, {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ recipient_id: discordUserId })
  });

  if (!dmResponse.ok) {
    const body = await dmResponse.text();
    throw new Error(`Failed to create DM channel: ${body}`);
  }

  const dmChannel = await dmResponse.json() as { id: string };
  const messageResponse = await fetch(`${baseUrl}/api/v10/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      content: 'Welcome! To connect your profile widget, use `/login` and then `/link username:<your stats.fm username>`.'
    })
  });

  if (!messageResponse.ok) {
    const body = await messageResponse.text();
    throw new Error(`Failed to send DM message: ${body}`);
  }
}

async function handleWebhookEventAsync(payload: {
  event?: {
    type?: string;
    data?: {
      user?: { id?: string };
    };
  };
}): Promise<void> {
  const eventType = payload.event?.type;
  const eventUserId = payload.event?.data?.user?.id;

  if (!eventType || !eventUserId) {
    return;
  }

  if (eventType === 'APPLICATION_AUTHORIZED') {
    try {
      await sendDmInstruction(eventUserId);
    } catch (error) {
      app.log.warn({ error }, 'failed to send authorized-event onboarding DM');
    }
    return;
  }

  if (eventType === 'APPLICATION_DEAUTHORIZED') {
    try {
      await patchDiscordProfileRemoved({
        discordUserId: eventUserId
      });
    } catch (error) {
      app.log.warn({ error }, 'failed to send deauthorized-event removal PATCH');
    }

    const user = await prisma.connectedUser.findUnique({where: { discordUserId: eventUserId }});

    await prisma.refreshLog.deleteMany({
      where: {
        connectedUserId: user?.id
      }
    })

    await prisma.statsSnapshot.deleteMany({
      where: {
        connectedUserId: user?.id
      }
    });

    await prisma.connectedUser.deleteMany({
      where: {
        discordUserId: eventUserId
      }
    });
    await syncConnectedUserMetrics();
  }
}

async function handleLoginCommand(discordUserId: string) {
  const oauthUrl = createOauthUrl(discordUserId);
  return discordResponse(
    'Use the button below to finish Discord OAuth login for this bot integration.',
    [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Login with Discord',
            url: oauthUrl
          }
        ]
      }
    ]
  );
}

async function handleLinkCommand(statsFmHandle: string) {
  const sanitizedHandle = statsFmHandle.trim();

  if (!sanitizedHandle) {
    return discordResponse('Missing username. Example: `/link username:MinerPL`');
  }

  const customId = `check_link:${encodeURIComponent(sanitizedHandle)}`;

  return discordResponse(
    [
      `To link stats.fm, connect your Discord account to your stats.fm, you can remove it after verification:`,
      '',
      `stats.fm account: \`${sanitizedHandle}\``,
      'Then click **Check connection**.'
    ].join('\n'),
    [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: customId,
            label: 'Check connection'
          },
          {
            type: 2,
            style: 5,
            label: 'Settings URL',
            url: "https://stats.fm/settings/connections"
          }
        ]
      }
    ]
  );
}

async function handleCheckLinkButton(discordUserId: string, customId: string) {
  const encodedHandle = customId.replace('check_link:', '');
  const statsFmHandle = decodeURIComponent(encodedHandle);

  try {
    const verification = await verifyStatsFmBioContainsDiscordUserId(statsFmHandle, discordUserId);

    if (!verification.ok) {
      return discordResponse(
        `Connection check failed. Connect your Discord account to your stats.fm account and try again.`
      );
    }

    if (!verification.plus) {
      return discordResponse(
        `Connection check failed. A stats.fm Plus subscription is required to connect your profile. Please subscribe to stats.fm Plus and try again.`
      );
    }

    await prisma.connectedUser.upsert({
      where: { discordUserId },
      update: {
        statsFmUsername: verification.customId,
        statsFmProfileUrl: `https://stats.fm/user/${verification.customId}`,
        isActive: true
      },
      create: {
        discordUserId,
        statsFmUsername: verification.customId,
        statsFmProfileUrl: `https://stats.fm/user/${verification.customId}`,
        displayName: verification.displayName,
        isActive: true
      }
    });

    await syncConnectedUserMetrics();
    await refreshConnectedUser(verification.userId);

  return discordResponse(`Connected successfully to stats.fm user \`${verification.customId}\`. You should see option to add widget on your profile.\n\nIf you don't see it, please use the following script to enable it:\n**This script is provided by Dziurwa and was shared in the [Discord Preview](https://discord.gg/discord-603970300668805120) server: https://canary.discord.com/channels/603970300668805120/1509942620762276011/1509942620762276011**\n\n\`\`\`js\nlet _mods=webpackChunkdiscord_app.push([[Symbol()],{},e=>e.c]);webpackChunkdiscord_app.pop();\nlet findByProps=(...e)=>{for(let t of Object.values(_mods))try{if(!t.exports||t.exports===window)continue;if(e.every(e=>t.exports?.[e]))return t.exports;for(let r in t.exports)if(e.every(e=>t.exports?.[r]?.[e])&&\"IntlMessagesProxy\"!==t.exports[r][Symbol.toStringTag])return t.exports[r]}catch{}};\n\n// Usage\nfindByProps(\"getFeaturedApplicationIds\").getFeaturedApplicationIds().push(\"${env.DISCORD_APPLICATION_ID || env.DISCORD_CLIENT_ID}\");\n\`\`\``);
  } catch (error) {
    return discordResponse(`Connection check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleRefreshCommand(discordUserId: string) {
  const user = await prisma.connectedUser.findUnique({
    where: { discordUserId }
  });

  if (!user) {
    return discordResponse('No linked account found. Run `/link username:<your stats.fm username>` first.');
  }

  const now = Date.now();
  const lastManual = user.lastManualRefreshAt?.getTime() ?? 0;
  const remainingMs = Math.max(0, env.MANUAL_REFRESH_COOLDOWN_MS - (now - lastManual));

  if (remainingMs > 0) {
    const cooldownEndUnix = Math.floor((now + remainingMs) / 1000);
    return discordResponse(`Manual refresh cooldown is active. Try again <t:${cooldownEndUnix}:R>.`);
  }

  await prisma.connectedUser.update({
    where: { id: user.id },
    data: { lastManualRefreshAt: new Date() }
  });

  const result = await refreshConnectedUser(user.id);
  if (!result.success) {
    console.log(`Refresh failed for user ${user.id}`);
    return discordResponse(`Refresh failed: ${result.error ?? 'Unknown error'}`);
  }

  return discordResponse('Refresh completed successfully.');
}

app.get('/health', async () => ({ ok: true }));

app.get('/metrics', async (_request, reply) => {
  reply.header('content-type', 'text/plain; version=0.0.4');
  return metricsText();
});

app.post('/webhook-events', async (request, reply) => {
  const verified = await verifyRequest(request, reply);
  if (!verified) {
    return;
  }

  const payload = request.body as {
    type?: number;
    event?: {
      type?: string;
      data?: {
        user?: { id?: string };
      };
    };
  };

  if (payload.type === 0) {
    reply.header('content-type', 'application/json');
    return reply.code(204).send();
  }

  if (payload.type === 1) {
    void handleWebhookEventAsync(payload).catch((error) => {
      app.log.error({ error }, 'webhook event processing failed');
    });

    reply.header('content-type', 'application/json');
    return reply.code(204).send();
  }

  reply.header('content-type', 'application/json');
  return reply.code(204).send();
});

app.get('/auth/discord/callback', async (request, reply) => {
  try {
    requireDiscordOAuthConfig();
  } catch (error) {
    reply.code(500);
    return { error: error instanceof Error ? error.message : 'Discord OAuth is not configured' };
  }

  const query = request.query as {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };

  if (query.error) {
    reply.code(400);
    return `Discord OAuth failed: ${query.error_description ?? query.error}`;
  }

  if (!query.code || !query.state) {
    reply.code(400);
    return 'Missing OAuth code or state.';
  }

  cleanupExpiredOauthState();
  const oauthState = oauthStateStore.get(query.state);
  oauthStateStore.delete(query.state);

  if (!oauthState) {
    reply.code(400);
    return 'Invalid or expired OAuth state.';
  }

  const tokenResponse = await fetch(`${toApiOrigin(env.DISCORD_API_BASE_URL)}/api/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: env.DISCORD_REDIRECT_URI
    })
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    reply.code(502);
    return `Failed to exchange OAuth code: ${body}`;
  }

  const tokenPayload = await tokenResponse.json() as {
    access_token?: string;
    token_type?: string;
  };

  if (!tokenPayload.access_token) {
    reply.code(502);
    return 'OAuth response did not include access_token.';
  }

  const meResponse = await fetch(`${toApiOrigin(env.DISCORD_API_BASE_URL)}/api/users/@me`, {
    headers: {
      authorization: `${tokenPayload.token_type ?? 'Bearer'} ${tokenPayload.access_token}`
    }
  });

  if (!meResponse.ok) {
    const body = await meResponse.text();
    reply.code(502);
    return `Failed to fetch Discord user profile: ${body}`;
  }

  const discordUser = await meResponse.json() as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  if (discordUser.id !== oauthState.expectedDiscordUserId) {
    reply.code(400);
    return 'OAuth user mismatch. Start /login again from the same Discord account.';
  }

  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=256`
    : null;

  await prisma.connectedUser.upsert({
    where: { discordUserId: discordUser.id },
    update: {
      displayName: discordUser.global_name ?? discordUser.username,
      avatarUrl,
      isActive: true
    },
    create: {
      discordUserId: discordUser.id,
      displayName: discordUser.global_name ?? discordUser.username,
      avatarUrl,
      isActive: true
    }
  });

  await syncConnectedUserMetrics();

  reply.header('content-type', 'text/plain; charset=utf-8');
  return 'Discord OAuth login successful. You can return to Discord and continue with /link.';
});

app.post('/interactions', async (request, reply) => {
  const verified = await verifyRequest(request, reply);
  if (!verified) {
    return;
  }

  const interaction = request.body as {
    type: number;
    data?: {
      name?: string;
      custom_id?: string;
      options?: Array<{ name: string; value?: string }>;
    };
    member?: { user?: { id?: string } };
    user?: { id?: string };
  };

  if (interaction.type === 1) {
    return { type: 1 };
  }

  const discordUserId = interactionUserId(interaction);
  if (!discordUserId) {
    return discordResponse('Could not determine your Discord user ID.');
  }

  if (interaction.type === 2) {
    const commandName = interaction.data?.name;

    if (commandName === 'login') {
      return handleLoginCommand(discordUserId);
    }

    if (commandName === 'link') {
      const usernameOption = interaction.data?.options?.find((option) => option.name === 'username')?.value;
      return handleLinkCommand(usernameOption ?? '');
    }

    if (commandName === 'refresh') {
      return handleRefreshCommand(discordUserId);
    }

    return discordResponse('Unknown command.');
  }

  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id ?? '';
    if (customId.startsWith('check_link:')) {
      return handleCheckLinkButton(discordUserId, customId);
    }

    return discordResponse('Unknown component action.');
  }

  return discordResponse('Unsupported interaction type.');
});

app.post('/bot/register-commands', async (request, reply) => {
  try {
    requireAdmin(typeof request.headers['x-admin-token'] === 'string' ? request.headers['x-admin-token'] : undefined);
  } catch {
    reply.code(401);
    return { error: 'Unauthorized' };
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_BOT_TOKEN) {
    reply.code(500);
    return { error: 'DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN are required' };
  }

  const commands = [
    {
      name: 'login',
      description: 'Start Discord OAuth login for this bot integration',
      contexts: [0, 1, 2]
    },
    {
      name: 'link',
      description: 'Link your stats.fm account',
      contexts: [0, 1, 2],
      options: [
        {
          type: 3,
          name: 'username',
          description: 'stats.fm username or profile URL',
          required: true
        }
      ]
    },
    {
      name: 'refresh',
      description: 'Refresh your stats now (1h cooldown)',
      contexts: [0, 1, 2]
    }
  ];

  const response = await fetch(`${toApiOrigin(env.DISCORD_API_BASE_URL)}/api/v10/applications/${env.DISCORD_CLIENT_ID}/commands`, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  const body = await response.text();
  if (!response.ok) {
    reply.code(502);
    return { error: body };
  }

  return { ok: true, commands: JSON.parse(body) };
});

app.setNotFoundHandler(async (_request, reply) => {
  const appId = env.DISCORD_APPLICATION_ID || env.DISCORD_CLIENT_ID;
  const targetUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}`;

  return reply.redirect(targetUrl);
});

async function startScheduler() {
  await syncConnectedUserMetrics();
  await refreshAllUsers();
  const interval = setInterval(() => {
    void refreshAllUsers().catch((error) => app.log.error({ error }, 'scheduled refresh failed'));
  }, env.STATS_REFRESH_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(interval);
    await prisma.$disconnect();
  });
}

async function main() {
  await prisma.$connect();
  await startScheduler();

  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`server listening on ${address}`);
}

void main().catch(async (error) => {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
