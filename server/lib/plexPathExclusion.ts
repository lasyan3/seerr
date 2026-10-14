/**
 * Fork feature: ignore Plex files stored under one of the paths listed in the
 * PLEX_EXCLUDED_PATHS environment variable (comma separated prefixes, as seen
 * by Plex), e.g. trailers sharing the TMDB ID of the real media. Excluded
 * files never make a media available through the Plex scans, and a media only
 * backed by excluded files is reset to UNKNOWN by the availability sync,
 * unless Radarr/Sonarr have the files.
 */

interface PlexVersion {
  Part?: { file?: string }[];
}

export const getExcludedPaths = (): string[] =>
  (process.env.PLEX_EXCLUDED_PATHS ?? '')
    .split(',')
    .map((path) => path.trim().replace(/[/\\]+$/, ''))
    .filter((path) => path.length > 0);

/** Whole path segments only: /media/umtk excludes /media/umtk/a, not /media/umtk2 */
export const isExcludedPath = (
  path: string | undefined,
  excludedPaths = getExcludedPaths()
): boolean =>
  !!path &&
  excludedPaths.some(
    (excluded) =>
      path === excluded ||
      path.startsWith(`${excluded}/`) ||
      path.startsWith(`${excluded}\\`)
  );

/**
 * Versions of a Plex item that are not excluded. A version is excluded when
 * all of its files are under an excluded path; a version without file
 * information is kept.
 */
export const keepNotExcludedVersions = <T extends PlexVersion>(
  versions: T[] | undefined,
  excludedPaths = getExcludedPaths()
): T[] =>
  (versions ?? []).filter(
    (version) =>
      !(
        version.Part?.length &&
        version.Part.every((part) => isExcludedPath(part.file, excludedPaths))
      )
  );

/** True when the item has versions and all of them are excluded */
export const hasOnlyExcludedVersions = (
  versions: PlexVersion[] | undefined,
  excludedPaths = getExcludedPaths()
): boolean =>
  excludedPaths.length > 0 &&
  !!versions?.length &&
  keepNotExcludedVersions(versions, excludedPaths).length === 0;

/** True when the show has folders and all of them are excluded */
export const isExcludedShow = (
  locations: { path: string }[] | undefined,
  excludedPaths = getExcludedPaths()
): boolean =>
  excludedPaths.length > 0 &&
  !!locations?.length &&
  locations.every((location) => isExcludedPath(location.path, excludedPaths));
