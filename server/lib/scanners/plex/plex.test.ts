import animeList from '@server/api/animelist';
import type {
  PlexLibrary,
  PlexLibraryItem,
  PlexMetadata,
} from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import type { TmdbTvDetails } from '@server/api/themoviedb/interfaces';
import { MediaStatus, MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import { plexFullScanner, plexRecentScanner } from '@server/lib/scanners/plex';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import { runWithMockTimers } from '@server/test/runWithMockTimers';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

// --- Mocks ---
Object.defineProperty(animeList, 'sync', {
  value: async () => {},
  configurable: true,
  writable: true,
});

let getLibraryContentsImpl: (
  id: string
) => Promise<{ totalSize: number; items: PlexLibraryItem[] }> = async () => ({
  totalSize: 0,
  items: [],
});
let getRecentlyAddedImpl: (
  id: string
) => Promise<PlexLibraryItem[]> = async () => [];
let getMetadataImpl: (key: string) => Promise<PlexMetadata> = async () => {
  throw new Error('404');
};
let getChildrenMetadataImpl: (
  key: string
) => Promise<PlexMetadata[]> = async () => [];

const plexMocks: Record<string, (...args: never[]) => unknown> = {
  getLibraries: async (): Promise<PlexLibrary[]> => [],
  getLibraryContents: (id: string) => getLibraryContentsImpl(id),
  getRecentlyAdded: (id: string) => getRecentlyAddedImpl(id),
  getMetadata: (key: string) => getMetadataImpl(key),
  getChildrenMetadata: (key: string) => getChildrenMetadataImpl(key),
};

for (const [method, impl] of Object.entries(plexMocks)) {
  Object.defineProperty(PlexAPI.prototype, method, {
    get() {
      return impl;
    },
    set() {},
    configurable: true,
  });
}

function fakeTmdbShow(tmdbId: number): TmdbTvDetails {
  return {
    id: tmdbId,
    name: 'Test Show',
    seasons: [
      {
        id: 1,
        air_date: '2024-01-01',
        episode_count: 2,
        name: 'Season 1',
        overview: '',
        season_number: 1,
      },
    ],
    external_ids: { tvdb_id: tmdbId * 10 },
    keywords: { results: [] },
  } as unknown as TmdbTvDetails;
}

// getTvShowForScan is assigned in the constructor, so stub the instances
for (const scanner of [plexFullScanner, plexRecentScanner]) {
  Object.defineProperty(scanner.tmdb, 'getTvShowForScan', {
    value: async ({ tvId }: { tvId: number }) => fakeTmdbShow(tvId),
    configurable: true,
  });
}

mock.method(MediaRequest, 'sendNotification', async () => undefined);

setupTestDb();

// --- Helpers ---
const MEDIA = [
  {
    id: 1,
    duration: 7200,
    bitrate: 8000,
    width: 1920,
    height: 1080,
    aspectRatio: 1.78,
    audioChannels: 2,
    audioCodec: 'aac',
    videoCodec: 'h264',
    videoResolution: '1080',
    container: 'mkv',
    videoFrameRate: '24p',
    videoProfile: 'high',
  },
];

const MOVIES = '/media/movies';
const TRAILERS = '/media/umtk/movies';

function versions(files: string[]): PlexLibraryItem['Media'] {
  return files.map((file, i) => ({ ...MEDIA[0], id: i, Part: [{ file }] }));
}

function fakeMovie(
  ratingKey: string,
  tmdbId: number,
  files: string[] = [`${MOVIES}/${ratingKey}.mkv`]
): PlexLibraryItem {
  return {
    ratingKey,
    title: `Movie ${ratingKey}`,
    guid: `plex://movie/${ratingKey}`,
    Guid: [{ id: `tmdb://${tmdbId}` }],
    addedAt: 1700000000,
    updatedAt: 1700000000,
    type: 'movie',
    Media: versions(files),
  };
}

function fakeShowMetadata(
  ratingKey: string,
  tmdbId: number,
  path: string
): PlexMetadata {
  return {
    ratingKey,
    guid: `plex://show/${ratingKey}`,
    type: 'show',
    title: `Show ${ratingKey}`,
    Guid: [{ id: `tmdb://${tmdbId}` }],
    Children: {
      size: 12,
      Metadata: [
        {
          ratingKey: `${ratingKey}-s1`,
          guid: `plex://season/${ratingKey}-s1`,
          type: 'season',
          title: 'Season 1',
          Guid: [],
          index: 1,
          leafCount: 2,
          viewedLeafCount: 0,
          addedAt: 0,
          updatedAt: 0,
          Media: [],
        },
      ],
    },
    index: 1,
    leafCount: 2,
    viewedLeafCount: 0,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    Media: [],
    Location: [{ path }],
  };
}

function fakeEpisode(showRatingKey: string, index: number): PlexLibraryItem {
  return {
    ratingKey: `${showRatingKey}-e${index}`,
    parentRatingKey: `${showRatingKey}-s1`,
    grandparentRatingKey: showRatingKey,
    title: `Episode ${index}`,
    guid: `plex://episode/${showRatingKey}-e${index}`,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    type: 'episode',
    Media: MEDIA,
  };
}

function configurePlexLibraries(): void {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.radarr = [];
  settings.sonarr = [];
  settings.plex.libraries = [
    { id: '1', name: 'Films', enabled: true, type: 'movie' },
    { id: '2', name: 'Séries', enabled: true, type: 'show' },
  ];
}

function excludeTrailers(): void {
  process.env.PLEX_EXCLUDED_PATHS = '/media/umtk';
}

function stubShows(shows: Record<string, [number, string]>): void {
  getMetadataImpl = async (key) => {
    if (shows[key]) {
      return fakeShowMetadata(key, ...shows[key]);
    }
    throw new Error('404');
  };
  getChildrenMetadataImpl = async () =>
    [1, 2].map(
      (i) =>
        ({
          ...fakeEpisode('x', i),
          index: i,
          leafCount: 0,
          viewedLeafCount: 0,
        }) as unknown as PlexMetadata
    );
}

async function findMedia(tmdbId: number): Promise<Media | null> {
  return getRepository(Media).findOne({ where: { tmdbId } });
}

describe('Plex Scanner - path exclusion (fork)', () => {
  beforeEach(() => {
    configurePlexLibraries();
    getLibraryContentsImpl = async () => ({ totalSize: 0, items: [] });
    getRecentlyAddedImpl = async () => [];
    getMetadataImpl = async () => {
      throw new Error('404');
    };
    getChildrenMetadataImpl = async () => [];
  });

  afterEach(() => {
    delete process.env.PLEX_EXCLUDED_PATHS;
    const settings = getSettings();
    settings.plex.libraries = [];
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
  });

  it('scans everything when no path is configured', async () => {
    getLibraryContentsImpl = async (id) =>
      id === '1'
        ? {
            totalSize: 1,
            items: [fakeMovie('m1', 9001, [`${TRAILERS}/m1.mkv`])],
          }
        : { totalSize: 0, items: [] };

    await runWithMockTimers(() => plexFullScanner.run());

    assert.strictEqual((await findMedia(9001))?.status, MediaStatus.AVAILABLE);
  });

  it('full scan skips movies only stored under an excluded path', async () => {
    excludeTrailers();
    getLibraryContentsImpl = async (id) =>
      id === '1'
        ? {
            totalSize: 3,
            items: [
              fakeMovie('m-trailer', 9002, [`${TRAILERS}/m-trailer.mkv`]),
              fakeMovie('m-plain', 9003),
              // Trailer and real movie merged by Plex in one item
              fakeMovie('m-merged', 9011, [
                `${TRAILERS}/m-merged.mkv`,
                `${MOVIES}/m-merged.mkv`,
              ]),
            ],
          }
        : { totalSize: 0, items: [] };

    await runWithMockTimers(() => plexFullScanner.run());

    assert.strictEqual(await findMedia(9002), null);
    assert.strictEqual((await findMedia(9003))?.status, MediaStatus.AVAILABLE);
    assert.strictEqual((await findMedia(9011))?.status, MediaStatus.AVAILABLE);
  });

  it('does not take the 4K resolution from an excluded version', async () => {
    excludeTrailers();
    getSettings().radarr = [
      { is4k: true } as ReturnType<typeof getSettings>['radarr'][number],
    ];
    const movie = fakeMovie('m-4k-trailer', 9012, [
      `${TRAILERS}/m-4k-trailer.mkv`,
      `${MOVIES}/m-4k-trailer.mkv`,
    ]);
    movie.Media[0].videoResolution = '4k';
    getLibraryContentsImpl = async (id) =>
      id === '1'
        ? { totalSize: 1, items: [movie] }
        : { totalSize: 0, items: [] };

    await runWithMockTimers(() => plexFullScanner.run());

    const media = await findMedia(9012);
    assert.strictEqual(media?.status, MediaStatus.AVAILABLE);
    assert.notStrictEqual(media?.status4k, MediaStatus.AVAILABLE);
  });

  it('recently added scan skips movies only stored under an excluded path', async () => {
    excludeTrailers();
    getRecentlyAddedImpl = async (id) =>
      id === '1'
        ? [
            fakeMovie('m-recent-trailer', 9004, [`${TRAILERS}/r.mkv`]),
            fakeMovie('m-recent', 9005),
          ]
        : [];

    await runWithMockTimers(() => plexRecentScanner.run());

    assert.strictEqual(await findMedia(9004), null);
    assert.strictEqual((await findMedia(9005))?.status, MediaStatus.AVAILABLE);
  });

  it('full scan skips shows only stored under an excluded path', async () => {
    excludeTrailers();
    const show = {
      ...fakeMovie('s-trailer', 9006),
      guid: 'plex://show/s-trailer',
      type: 'show' as const,
    };
    stubShows({
      's-trailer': [9006, '/media/umtk/tv/Show'],
      's-plain': [9007, '/media/tv/Show'],
    });
    getLibraryContentsImpl = async (id) =>
      id === '2'
        ? {
            totalSize: 2,
            items: [
              show,
              { ...show, ratingKey: 's-plain', guid: 'plex://show/p' },
            ],
          }
        : { totalSize: 0, items: [] };

    await runWithMockTimers(() => plexFullScanner.run());

    assert.strictEqual(await findMedia(9006), null);
    const plain = await findMedia(9007);
    assert.strictEqual(plain?.mediaType, MediaType.TV);
    assert.strictEqual(plain?.status, MediaStatus.AVAILABLE);
  });

  it('recently added scan skips episodes of excluded shows', async () => {
    excludeTrailers();
    stubShows({
      's-recent-trailer': [9008, '/media/umtk/tv/Show'],
      's-recent-plain': [9009, '/media/tv/Show'],
    });
    getRecentlyAddedImpl = async (id) =>
      id === '2'
        ? [fakeEpisode('s-recent-trailer', 1), fakeEpisode('s-recent-plain', 1)]
        : [];

    await runWithMockTimers(() => plexRecentScanner.run());

    assert.strictEqual(await findMedia(9008), null);
    assert.strictEqual((await findMedia(9009))?.status, MediaStatus.AVAILABLE);
  });
});
