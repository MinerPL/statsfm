import { Api, SearchTypes } from '@statsfm/statsfm.js';
import { env } from '../config';

const statsfm = new Api({
  auth: env.STATSFM_ACCESS_TOKEN ? { accessToken: env.STATSFM_ACCESS_TOKEN } : {}
});

function normalizeStatsFmHandle(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('stats.fm username is required');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const fromUrl = trimmed.match(/(?:stats\.fm\/user\/|stats\.fm\/@)([^/?#]+)/i)?.[1];
    if (fromUrl) {
      return fromUrl;
    }

    throw new Error('Could not parse stats.fm username from URL');
  }

  return trimmed.replace(/^@+/, '');
}

export async function resolveStatsFmUser(handleInput: string): Promise<{ id: string; customId: string; displayName: string }> {
  const handle = normalizeStatsFmHandle(handleInput);

  try {
    const user = await statsfm.users.get(handle);
    return {
      id: user.id,
      customId: user.customId,
      displayName: user.displayName
    };
  } catch {
    const results = await statsfm.search.search(handle, [SearchTypes.USER], { limit: 10 });
    const users = results.users ?? [];

    const match = users.find((user) =>
      user.customId?.toLowerCase() === handle.toLowerCase()
      || user.displayName?.toLowerCase() === handle.toLowerCase()
    ) ?? users[0];

    if (!match) {
      throw new Error(`stats.fm user not found for '${handleInput}'`);
    }

    return {
      id: match.id,
      customId: match.customId,
      displayName: match.displayName
    };
  }
}

export async function verifyStatsFmBioContainsDiscordUserId(
  handleInput: string,
  discordUserId: string
): Promise<{ ok: boolean; matchedText?: string; userId: string; customId: string; plus: boolean; displayName: string }> {
  const user = await resolveStatsFmUser(handleInput);
  const profile = await statsfm.users.get(user.id);

  const connection = profile.socialMediaConnections.find((connection) => connection.platform.name === "Discord")
    if (!connection) {
      return {
        ok: false,
        matchedText: undefined,
        plus: profile.isPlus || false,
        userId: user.id,
        customId: user.customId,
        displayName: user.displayName
      };
    }
    const ok = connection.platformUserId === discordUserId;

  return {
    ok,
    matchedText: ok ? discordUserId : undefined,
    userId: connection.platformUserId,
    plus: profile.isPlus || false,
    customId: user.customId,
    displayName: user.displayName
  };
}
