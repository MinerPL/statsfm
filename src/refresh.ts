import { prisma } from './db';
import { connectedUsersGauge, refreshDurationHistogram, refreshFailureCounter, refreshRunningGauge, refreshSuccessCounter } from './metrics';
import { fetchStatsSnapshot } from './services/stats-provider';
import { patchDiscordProfile } from './services/discord-client';
import { env } from './config';

let refreshInProgress = false;

function setConnectedUserMetrics(count: number) {
  connectedUsersGauge.set(count);
}

export async function syncConnectedUserMetrics(): Promise<void> {
  const count = await prisma.connectedUser.count({ where: { isActive: true } });
  setConnectedUserMetrics(count);
}

export async function refreshConnectedUser(userId: string): Promise<{ success: boolean; error?: string; durationMs: number }> {
  const startedAt = Date.now();

  try {
    const user = await prisma.connectedUser.findUnique({
      where: { id: userId }
    });

    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    const snapshot = await fetchStatsSnapshot({
      discordUserId: user.discordUserId,
      discordIdentityId: user.discordIdentityId,
      statsFmUsername: user.statsFmUsername,
      statsFmProfileUrl: user.statsFmProfileUrl
    });

    await prisma.$transaction([
      prisma.statsSnapshot.upsert({
        where: { connectedUserId: user.id },
        update: {
          username: snapshot.username,
          statsfmUsername: snapshot.statsfmUsername,
          avatarUrl: snapshot.avatarUrl,
          avatarSmallUrl: snapshot.avatarSmallUrl,
          streams: snapshot.streams ?? 0,
          listeningTimeSec: snapshot.listeningTimeSec ?? 0n,
          artists: snapshot.artists ?? 0,
          mostStreamedArtist: snapshot.mostStreamedArtist,
          mostStreamedAlbum: snapshot.mostStreamedAlbum,
          topTrack: snapshot.topTrack,
          rawPayload: JSON.stringify(snapshot.rawPayload)
        },
        create: {
          connectedUserId: user.id,
          username: snapshot.username,
          statsfmUsername: snapshot.statsfmUsername,
          avatarUrl: snapshot.avatarUrl,
          avatarSmallUrl: snapshot.avatarSmallUrl,
          streams: snapshot.streams ?? 0,
          listeningTimeSec: snapshot.listeningTimeSec ?? 0n,
          artists: snapshot.artists ?? 0,
          mostStreamedArtist: snapshot.mostStreamedArtist,
          mostStreamedAlbum: snapshot.mostStreamedAlbum,
          topTrack: snapshot.topTrack,
          rawPayload: JSON.stringify(snapshot.rawPayload)
        }
      }),
      prisma.connectedUser.update({
        where: { id: user.id },
        data: {
          displayName: snapshot.username ?? user.displayName,
          avatarUrl: snapshot.avatarUrl ?? user.avatarUrl,
          lastRefreshedAt: new Date(),
          lastRefreshStatus: 'success',
          lastRefreshError: null,
          refreshFailures: 0
        }
      })
    ]);

    await patchDiscordProfile({
      discordUserId: user.discordUserId,
      discordIdentityId: user.discordIdentityId,
      displayName: snapshot.username ?? user.displayName,
      snapshot
    });

    const durationMs = Date.now() - startedAt;
    refreshSuccessCounter.inc();
    refreshDurationHistogram.observe(durationMs);
    await prisma.refreshLog.create({
      data: {
        connectedUserId: user.id,
        success: true,
        durationMs
      }
    });

    return { success: true, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : 'Unknown refresh error';

    refreshFailureCounter.inc();
    refreshDurationHistogram.observe(durationMs);

    const user = await prisma.connectedUser.findUnique({ where: { id: userId } });
    if (user) {
      await prisma.connectedUser.update({
        where: { id: user.id },
        data: {
          lastRefreshedAt: new Date(),
          lastRefreshStatus: 'failed',
          lastRefreshError: message,
          refreshFailures: { increment: 1 }
        }
      });
      await prisma.refreshLog.create({
        data: {
          connectedUserId: user.id,
          success: false,
          error: message,
          durationMs
        }
      });
    }

    return { success: false, error: message, durationMs };
  }
}

export async function refreshAllUsers(): Promise<{ processed: number; failed: number }> {
  if (refreshInProgress) {
    return { processed: 0, failed: 0 };
  }

  refreshInProgress = true;
  refreshRunningGauge.set(1);

  try {
    const users = await prisma.connectedUser.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: 'asc' }
    });

    let processed = 0;
    let failed = 0;
    const queue = [...users];
    const workers = Array.from({ length: Math.min(env.STATS_REFRESH_CONCURRENCY, queue.length || 1) }, async () => {
      while (queue.length > 0) {
        const nextUser = queue.shift();
        if (!nextUser) {
          break;
        }

        const result = await refreshConnectedUser(nextUser.id);
        processed += 1;
        if (!result.success) {
          failed += 1;
        }
      }
    });

    await Promise.all(workers);
    await syncConnectedUserMetrics();
    return { processed, failed };
  } finally {
    refreshRunningGauge.set(0);
    refreshInProgress = false;
  }
}
