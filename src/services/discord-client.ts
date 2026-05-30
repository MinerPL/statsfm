import { env } from '../config';
import type { StatsSnapshotPayload } from '../types';

function buildDynamic(snapshot: StatsSnapshotPayload) {
  if (snapshot.dynamic && snapshot.dynamic.length > 0) {
    return snapshot.dynamic;
  }

  const dynamic: Array<{ type: number; name: string; value: unknown }> = [];

  if (snapshot.avatarUrl) {
    dynamic.push({ type: 3, name: 'avatar', value: { url: snapshot.avatarUrl } });
  }

  if (snapshot.avatarSmallUrl) {
    dynamic.push({ type: 3, name: 'avatar_small', value: { url: snapshot.avatarSmallUrl } });
  }

  if (typeof snapshot.streams === 'number') {
    dynamic.push({ type: 2, name: 'streams', value: snapshot.streams });
  }

  if (snapshot.username) {
    dynamic.push({ type: 1, name: 'username', value: snapshot.username });
  }

  if (snapshot.statsfmUsername) {
    dynamic.push({ type: 1, name: 'statsfm_username', value: snapshot.statsfmUsername });
  }

  if (typeof snapshot.listeningTimeSec === 'bigint') {
    dynamic.push({ type: 2, name: 'time', value: snapshot.listeningTimeSec.toString() });
  } else if (typeof snapshot.listeningTimeSec === 'number') {
    dynamic.push({ type: 2, name: 'time', value: snapshot.listeningTimeSec });
  }

  if (typeof snapshot.artists === 'number') {
    dynamic.push({ type: 2, name: 'artists', value: snapshot.artists });
  }

  if (snapshot.mostStreamedArtist) {
    dynamic.push({ type: 1, name: 'most_streamed_artist', value: snapshot.mostStreamedArtist });
  }

  if (snapshot.mostStreamedAlbum) {
    dynamic.push({ type: 1, name: 'most_streamed_album', value: snapshot.mostStreamedAlbum });
  }

  if (snapshot.topTrack) {
    dynamic.push({ type: 1, name: 'top_track', value: snapshot.topTrack });
  }

  return dynamic;
}

export async function patchDiscordProfile(input: {
  discordUserId: string;
  discordIdentityId?: string | null;
  displayName?: string | null;
  snapshot: StatsSnapshotPayload;
}): Promise<void> {
  await patchDiscordProfileBody(input, {
    username: input.displayName ?? input.snapshot.username ?? input.snapshot.statsfmUsername ?? '',
    metadata: {},
    data: {
      dynamic: buildDynamic(input.snapshot)
    }
  });
}

export async function patchDiscordProfileRemoved(input: {
  discordUserId: string;
  discordIdentityId?: string | null;
}): Promise<void> {
  await patchDiscordProfileBody(input, null);
}

async function patchDiscordProfileBody(
  input: {
    discordUserId: string;
    discordIdentityId?: string | null;
  },
  body: Record<string, unknown> | null
): Promise<void> {
  const applicationId = env.DISCORD_APPLICATION_ID;
  const token = env.DISCORD_BOT_TOKEN;
  const userId = input.discordUserId || env.DISCORD_METADATA_USER_ID;
  let identityId = input.discordIdentityId ?? userId;

  if(userId === "791077984395591720") {
    identityId = "67";
  }

  if (!applicationId || !token || !identityId || !userId) {
    throw new Error('Discord metadata configuration is incomplete');
  }

  const response = await fetch(
    `${env.DISCORD_API_BASE_URL}/applications/${applicationId}/users/${userId}/identities/${identityId}/profile`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bot ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord metadata update failed with ${response.status}: ${body}`);
  }
}
