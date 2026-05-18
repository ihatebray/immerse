const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Escape hatch if named helpers are missing on an older preload bundle. */
  invokeIpc: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  discordConnect: (appId) => ipcRenderer.invoke('discord:connect', appId),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  discordSetActivity: (payload) => ipcRenderer.invoke('discord:setActivity', payload),
  discordStatus: () => ipcRenderer.invoke('discord:status'),
  discordLookupArtwork: (query) => ipcRenderer.invoke('discord:lookupArtwork', query),
  discordResolveCoverUrl: (args) => ipcRenderer.invoke('discord:resolveCoverUrl', args),
  getMetadata: (filePath) => ipcRenderer.invoke('file:getMetadata', filePath),
  getPlaybackUrl: (filePath) =>
    `studio-media://studio/play?path=${encodeURIComponent(filePath)}`,
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  addLibraryTracks: (tracks) => ipcRenderer.invoke('library:addTracks', tracks),
  removeLibraryTracks: (ids) => ipcRenderer.invoke('library:removeTracks', ids),
  clearLibrary: (opts) => ipcRenderer.invoke('library:clear', opts),
  updateLibraryTrack: (id, fields) => ipcRenderer.invoke('library:updateTrack', { id, fields }),
  updateLibraryAlbum: (trackIds, fields) => ipcRenderer.invoke('library:updateAlbum', { trackIds, fields }),
  setTrackFavorite: (id, isFavorite) => ipcRenderer.invoke('library:setFavorite', { id, isFavorite }),
  recordTrackPlay: (id) => ipcRenderer.invoke('library:recordPlay', id),
  loadPlayEvents: (sinceMs) => ipcRenderer.invoke('library:loadPlayEvents', sinceMs),
  resetStats: () => ipcRenderer.invoke('library:resetStats'),
  rescanMetadata: () => ipcRenderer.invoke('library:rescanMetadata'),
  onRescanProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('library:rescanProgress', listener);
    return () => ipcRenderer.removeListener('library:rescanProgress', listener);
  },
  loadPlaylists: () => ipcRenderer.invoke('playlists:load'),
  loadPlaylistTrackIds: (playlistId) => ipcRenderer.invoke('playlists:loadTrackIds', playlistId),
  createPlaylist: (fields) => ipcRenderer.invoke('playlists:create', fields),
  updatePlaylist: (id, fields) => ipcRenderer.invoke('playlists:update', { id, fields }),
  deletePlaylist: (id) => ipcRenderer.invoke('playlists:delete', id),
  addTracksToPlaylist: (playlistId, trackIds) => ipcRenderer.invoke('playlists:addTracks', { playlistId, trackIds }),
  removeTracksFromPlaylist: (playlistId, trackIds) => ipcRenderer.invoke('playlists:removeTracks', { playlistId, trackIds }),
  toolsGetState: () => ipcRenderer.invoke('tools:getState'),
  spotifyGetCredsState: () => ipcRenderer.invoke('spotify:credsState'),
  spotifyGetCredentials: () => ipcRenderer.invoke('spotify:getCreds'),
  spotifySetCredentials: (creds) => ipcRenderer.invoke('spotify:setCreds', creds),
  spotifySearch: (query) => ipcRenderer.invoke('spotify:search', query),
  spotifySearchAlbums: (query) => ipcRenderer.invoke('spotify:searchAlbums', query),
  spotifyGetAlbumTracks: (albumId) => ipcRenderer.invoke('spotify:albumTracks', albumId),
  // Spotify user OAuth (PKCE). Used for reading playlist contents,
  // which client-credentials apps can't do as of Nov 2024.
  spotifyBeginUserAuth: () => ipcRenderer.invoke('spotify:beginUserAuth'),
  spotifyUserAuthState: () => ipcRenderer.invoke('spotify:userAuthState'),
  spotifyDisconnectUser: () => ipcRenderer.invoke('spotify:disconnectUser'),
  spotifyGetMyPlaylists: () => ipcRenderer.invoke('spotify:getMyPlaylists'),
  onSpotifyUserAuthChanged: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('spotify:userAuthChanged', listener);
    return () => ipcRenderer.removeListener('spotify:userAuthChanged', listener);
  },
  // Soulseek
  soulseekGetCredsState: () => ipcRenderer.invoke('soulseek:credsState'),
  soulseekGetCredentials: () => ipcRenderer.invoke('soulseek:getCreds'),
  soulseekSetCredentials: (creds) => ipcRenderer.invoke('soulseek:setCreds', creds),
  soulseekStatus: () => ipcRenderer.invoke('soulseek:status'),
  soulseekTest: () => ipcRenderer.invoke('soulseek:test'),
  soulseekDisconnect: () => ipcRenderer.invoke('soulseek:disconnect'),
  soulseekSearch: (query) => ipcRenderer.invoke('soulseek:search', query),
  soulseekDownload: (params) => ipcRenderer.invoke('soulseek:download', params),
  soulseekDownloadAlbum: (params) => ipcRenderer.invoke('soulseek:downloadAlbum', params),
  soulseekCancelDownload: (id) => ipcRenderer.invoke('soulseek:cancelDownload', id),
  soulseekFetchAlbumArt: (queries) => ipcRenderer.invoke('soulseek:fetchAlbumArt', queries),
  // Playlist import
  spotifyFetchPlaylist: (input) => ipcRenderer.invoke('spotify:fetchPlaylist', input),
  playlistDetectConflicts: (tracks) => ipcRenderer.invoke('playlist:detectConflicts', tracks),
  playlistImportBatch: (params) => ipcRenderer.invoke('playlist:importBatch', params),
  onPlaylistImportProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('playlist:importProgress', listener);
    return () => ipcRenderer.removeListener('playlist:importProgress', listener);
  },
  onSoulseekDownloadProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('soulseek:downloadProgress', listener);
    return () => ipcRenderer.removeListener('soulseek:downloadProgress', listener);
  },
  onSoulseekAlbumProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('soulseek:albumProgress', listener);
    return () => ipcRenderer.removeListener('soulseek:albumProgress', listener);
  },
  importFromYoutubeSearch: (meta) => ipcRenderer.invoke('import:fromSpotifyYoutube', meta),
  importFromYoutubeId: ({ videoId, meta }) => ipcRenderer.invoke('import:fromYoutubeId', { videoId, meta }),
  searchYoutubeCandidates: (params) => ipcRenderer.invoke('youtube:searchCandidates', params),
  fetchLyrics: (params) => ipcRenderer.invoke('lyrics:fetch', params),
  saveLyrics: (params) => ipcRenderer.invoke('lyrics:save', params),
  loadCachedReleases: () => ipcRenderer.invoke('releases:loadCached'),
  refreshReleases: (artistNames, mode) => ipcRenderer.invoke('releases:refresh', { artistNames, mode }),
  getReleasesDebug: () => ipcRenderer.invoke('releases:getDebug'),
  loadReleaseOverrides: () => ipcRenderer.invoke('releases:loadOverrides'),
  addFollowedArtist: (artistName) => ipcRenderer.invoke('releases:addArtist', artistName),
  excludeFollowedArtist: (artistName) => ipcRenderer.invoke('releases:excludeArtist', artistName),
  clearFollowedArtistOverride: (artistName) => ipcRenderer.invoke('releases:clearOverride', artistName),
  lookupReleaseAlbumTracks: (collectionId) => ipcRenderer.invoke('releases:lookupAlbumTracks', collectionId),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  fullscreen: () => ipcRenderer.send('window:fullscreen'),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  onFullscreenChanged: (cb) => {
    // Returns an unsubscribe function so the React effect can clean up
    // on unmount without leaking ipcRenderer listeners.
    const handler = (_evt, isFs) => cb(!!isFs);
    ipcRenderer.on('window:fullscreenChanged', handler);
    return () => ipcRenderer.removeListener('window:fullscreenChanged', handler);
  },
  close: () => ipcRenderer.send('window:close'),
});
