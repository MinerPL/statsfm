import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { verifyKey } from 'discord-interactions';
import { prisma } from './db';
import { env } from './config';
import { metricsText } from './metrics';
import { refreshAllUsers, refreshConnectedUser, syncConnectedUserMetrics } from './refresh';
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

async function handleLinkCommand(discordUserId: string, statsFmHandle: string) {
  const sanitizedHandle = statsFmHandle.trim();

  if (!sanitizedHandle) {
    return discordResponse('Missing username. Example: `/link username:MinerPL`');
  }

  const customId = `check_link:${encodeURIComponent(sanitizedHandle)}`;
  return discordResponse(
    [
      `To link stats.fm, add your Discord user ID to your stats.fm bio, you can remove it after verification:`,
      `\`${discordUserId}\``,
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
        `Connection check failed. Add your Discord ID \`${discordUserId}\` to your stats.fm bio and try again.`
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

    return discordResponse(`Connected successfully to stats.fm user \`${verification.customId}\`. You should see option to add widget on your profile.`);
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
    return discordResponse(`Refresh failed: ${result.error ?? 'Unknown error'}`);
  }

  return discordResponse('Refresh completed successfully.');
}

app.get('/health', async () => ({ ok: true }));

app.get('/metrics', async (_request, reply) => {
  reply.header('content-type', 'text/plain; version=0.0.4');
  return metricsText();
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
      return handleLinkCommand(discordUserId, usernameOption ?? '');
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
