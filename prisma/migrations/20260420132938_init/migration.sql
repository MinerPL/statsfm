-- CreateTable
CREATE TABLE "ConnectedUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordUserId" TEXT NOT NULL,
    "discordIdentityId" TEXT,
    "statsFmUsername" TEXT,
    "statsFmProfileUrl" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastRefreshedAt" DATETIME,
    "lastRefreshStatus" TEXT NOT NULL DEFAULT 'never',
    "lastRefreshError" TEXT,
    "refreshFailures" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "StatsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectedUserId" TEXT NOT NULL,
    "username" TEXT,
    "statsfmUsername" TEXT,
    "avatarUrl" TEXT,
    "avatarSmallUrl" TEXT,
    "streams" INTEGER NOT NULL DEFAULT 0,
    "listeningTimeSec" BIGINT NOT NULL DEFAULT 0,
    "artists" INTEGER NOT NULL DEFAULT 0,
    "mostStreamedArtist" TEXT,
    "mostStreamedAlbum" TEXT,
    "topTrack" TEXT,
    "rawPayload" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatsSnapshot_connectedUserId_fkey" FOREIGN KEY ("connectedUserId") REFERENCES "ConnectedUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectedUserId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshLog_connectedUserId_fkey" FOREIGN KEY ("connectedUserId") REFERENCES "ConnectedUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedUser_discordUserId_key" ON "ConnectedUser"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StatsSnapshot_connectedUserId_key" ON "StatsSnapshot"("connectedUserId");
