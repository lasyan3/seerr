import {
  getExcludedPaths,
  hasOnlyExcludedVersions,
  isExcludedPath,
  isExcludedShow,
  keepNotExcludedVersions,
} from '@server/lib/plexPathExclusion';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const version = (...files: string[]) => ({
  Part: files.map((file) => ({ file })),
});

describe('plexPathExclusion', () => {
  afterEach(() => {
    delete process.env.PLEX_EXCLUDED_PATHS;
  });

  describe('getExcludedPaths', () => {
    it('returns an empty list when the variable is not set', () => {
      assert.deepStrictEqual(getExcludedPaths(), []);
    });

    it('splits and trims the paths, dropping trailing separators and empty entries', () => {
      process.env.PLEX_EXCLUDED_PATHS = ' /media/umtk/ , ,D:\\Trailers\\ ';
      assert.deepStrictEqual(getExcludedPaths(), [
        '/media/umtk',
        'D:\\Trailers',
      ]);
    });
  });

  describe('isExcludedPath', () => {
    const excluded = ['/media/umtk', 'D:\\Trailers'];

    it('matches the folder itself and everything below it', () => {
      assert.strictEqual(isExcludedPath('/media/umtk', excluded), true);
      assert.strictEqual(
        isExcludedPath('/media/umtk/movies/a.mkv', excluded),
        true
      );
      assert.strictEqual(isExcludedPath('D:\\Trailers\\a.mkv', excluded), true);
    });

    it('does not match a sibling folder sharing the prefix', () => {
      assert.strictEqual(isExcludedPath('/media/umtk2/a.mkv', excluded), false);
      assert.strictEqual(
        isExcludedPath('/media/movies/a.mkv', excluded),
        false
      );
      assert.strictEqual(isExcludedPath(undefined, excluded), false);
    });
  });

  describe('versions and shows', () => {
    const excluded = ['/media/umtk'];

    it('keeps versions outside the excluded paths and versions without files', () => {
      const trailer = version('/media/umtk/a.mkv');
      const movie = version('/media/movies/a.mkv');
      const split = version('/media/umtk/a1.mkv', '/media/movies/a2.mkv');
      const unknown = {};

      assert.deepStrictEqual(
        keepNotExcludedVersions([trailer, movie, split, unknown], excluded),
        [movie, split, unknown]
      );
    });

    it('flags an item only when all of its versions are excluded', () => {
      const trailer = version('/media/umtk/a.mkv');
      const movie = version('/media/movies/a.mkv');

      assert.strictEqual(hasOnlyExcludedVersions([trailer], excluded), true);
      assert.strictEqual(
        hasOnlyExcludedVersions([trailer, movie], excluded),
        false
      );
      assert.strictEqual(hasOnlyExcludedVersions([], excluded), false);
      assert.strictEqual(hasOnlyExcludedVersions([trailer], []), false);
    });

    it('flags a show only when all of its folders are excluded', () => {
      const trailer = { path: '/media/umtk/tv/Show' };
      const show = { path: '/media/tv/Show' };

      assert.strictEqual(isExcludedShow([trailer], excluded), true);
      assert.strictEqual(isExcludedShow([trailer, show], excluded), false);
      assert.strictEqual(isExcludedShow(undefined, excluded), false);
      assert.strictEqual(isExcludedShow([trailer], []), false);
    });
  });
});
