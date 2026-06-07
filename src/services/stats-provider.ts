import { Api, OrderBySetting, Range, SearchTypes } from '@statsfm/statsfm.js';
import type { StatsSnapshotPayload } from '../types';

const statsfm = new Api();

function normalizeStatsFmHandle(input: {
  statsFmUsername?: string | null;
  statsFmProfileUrl?: string | null;
}): string {
  if (input.statsFmUsername && input.statsFmUsername.trim().length > 0) {
    return input.statsFmUsername.trim().replace(/^@+/, '');
  }

  if (input.statsFmProfileUrl && input.statsFmProfileUrl.trim().length > 0) {
    const trimmed = input.statsFmProfileUrl.trim();
    const fromUrl = trimmed.match(/(?:stats\.fm\/user\/|stats\.fm\/@)([^/?#]+)/i)?.[1];
    if (fromUrl) {
      return fromUrl;
    }
  }

  throw new Error('statsFmUsername or statsFmProfileUrl is required');
}

async function resolveUserId(handle: string): Promise<string> {
  try {
    const direct = await statsfm.users.get(handle);
    if (direct?.id) {
      return direct.id;
    }
  } catch {
    // Fall back to search-based lookup.
  }

  const searchResults = await statsfm.search.search(handle, [SearchTypes.USER], { limit: 10 });
  const users = searchResults.users ?? [];
  const normalizedHandle = handle.toLowerCase();

  const exactMatch = users.find((user) =>
    user.customId?.toLowerCase() === normalizedHandle
    || user.displayName?.toLowerCase() === normalizedHandle
  );

  if (exactMatch) {
    return exactMatch.id;
  }

  const firstResult = users[0];
  if (!firstResult) {
    throw new Error(`stats.fm user not found for handle: ${handle}`);
  }

  return firstResult.id;
}

export async function fetchStatsSnapshot(input: {
  discordUserId: string;
  discordIdentityId?: string | null;
  statsFmUsername?: string | null;
  statsFmProfileUrl?: string | null;
}): Promise<StatsSnapshotPayload> {
  const handle = normalizeStatsFmHandle(input);
  const userId = await resolveUserId(handle);

  const [profile, lifetimeStats, topArtists, topAlbums, topTracks] = await Promise.all([
    statsfm.users.get(userId),
    statsfm.users.stats(userId, { range: Range.LIFETIME }),
    statsfm.users.topArtists(userId, { range: Range.LIFETIME, orderBy: OrderBySetting.COUNT }),
    statsfm.users.topAlbums(userId, { range: Range.LIFETIME, orderBy: OrderBySetting.COUNT }),
    statsfm.users.topTracks(userId, { range: Range.LIFETIME, orderBy: OrderBySetting.COUNT })
  ]);

  const streams = lifetimeStats.count;
  const listeningTimeMs = lifetimeStats.durationMs;
  const listeningTimeRoundedMs = Math.round(listeningTimeMs / 60000) * 60000;
  const artists = lifetimeStats.cardinality.artists;
  const topArtistName = topArtists[0]?.artist?.name;
  const topArtistImage = topArtists[0]?.artist?.image;
  const avatarUrl = topArtistImage ?? profile.image;
  const avatarSmallUrl = topArtistImage ?? profile.image;
  const topAlbumName = topAlbums[0]?.album?.name;
  const topTrackName = topTracks[0]?.track?.name;
  const topTrackArtist = topTracks[0]?.track?.artists?.[0]?.name;
  const topTrackText = topTrackName
    ? `${topTrackName}${topTrackArtist ? ` by ${topTrackArtist}` : ''}`
    : undefined;

  const normalizedStatsfmUsername = `@${profile.customId || handle}`;

  const dynamic: Array<{ type: number; name: string; value: unknown }> = [
    { type: 3, name: 'avatar', value: { url: avatarUrl ?? '' } },
    { type: 3, name: 'avatar_small', value: { url: avatarSmallUrl ?? '' } },
    { type: 2, name: 'streams', value: streams },
    { type: 1, name: 'username', value: profile.displayName },
    { type: 1, name: 'statsfm_username', value: normalizedStatsfmUsername },
    { type: 2, name: 'time', value: listeningTimeRoundedMs },
    { type: 2, name: 'artists', value: artists },
    { type: 1, name: 'most_streamed_artist', value: topArtistName ?? '' },
    { type: 1, name: 'most_streamed_album', value: topAlbumName ?? '' },
    { type: 1, name: 'top_track', value: topTrackText ?? '' }
  ];

  const filteredDynamic = dynamic.filter((entry) => {
    if (entry.type === 3) {
      return typeof entry.value === 'object' && entry.value !== null
        && typeof (entry.value as { url?: unknown }).url === 'string'
        && ((entry.value as { url: string }).url.length > 0);
    }

    if (entry.type === 1) {
      return typeof entry.value === 'string' && entry.value.length > 0;
    }

    return typeof entry.value === 'number' && Number.isFinite(entry.value);
  });

  return {
    username: profile.displayName,
    statsfmUsername: normalizedStatsfmUsername,
    avatarUrl,
    avatarSmallUrl,
    streams,
    listeningTimeSec: BigInt(listeningTimeRoundedMs),
    artists,
    mostStreamedArtist: topArtistName,
    mostStreamedAlbum: topAlbumName,
    topTrack: topTrackText,
    dynamic: filteredDynamic,
    rawPayload: {
      profile,
      lifetimeStats,
      topArtists,
      topAlbums,
      topTracks
    }
  };
}
