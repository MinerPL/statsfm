export type StatsSnapshotPayload = {
  username?: string;
  statsfmUsername?: string;
  avatarUrl?: string;
  avatarSmallUrl?: string;
  streams?: number;
  listeningTimeSec?: bigint | number;
  artists?: number;
  mostStreamedArtist?: string;
  mostStreamedAlbum?: string;
  topTrack?: string;
  dynamic?: Array<{
    type: number;
    name: string;
    value: unknown;
  }>;
  rawPayload: unknown;
};

export type RefreshResult = {
  success: boolean;
  durationMs: number;
  error?: string;
};
