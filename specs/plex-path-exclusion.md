# Spec — Exclusion de fichiers Plex par chemin

Fork Seerr · base : `main` @ `e2f24cb4` (v3.5.0). Remplace l'exclusion par étiquette (branche `feat/plex-label-exclusion`).

## 1. Besoin

Des **trailers** sont rangés dans un dossier dédié de la même bibliothèque Plex que les vrais médias, avec le même TMDB ID (ex. films dans `/media/movies`, trailers dans `/media/umtk/movies`). Seerr ne doit pas les prendre pour le média :

- un média présent dans Plex **uniquement** sous un chemin exclu n'est jamais marqué *Disponible* par les scans Plex (récent et complet) ;
- s'il est déjà marqué disponible, *Media Availability Sync* le remet dans l'état d'avant, sauf si Radarr/Sonarr ont le fichier : *Demandé* (`PROCESSING`) s'il a une demande, sa demande *Terminée* étant rouverte ; *Inconnu* (`UNKNOWN`) s'il n'en a pas ;
- quand le vrai fichier arrive (hors chemin exclu, ou dans Radarr/Sonarr), le média redevient disponible normalement.

Hors périmètre : réglage dans l'UI, Jellyfin/Emby, filtrage épisode par épisode.

## 2. Configuration

| Variable d'env. | Exemple | Comportement |
|---|---|---|
| `PLEX_EXCLUDED_PATHS` | `/media/umtk` | Préfixes séparés par des virgules, espaces et séparateur final ignorés. Comparaison par dossier entier : `/media/umtk` exclut `/media/umtk/movies/a.mkv`, pas `/media/umtk2/a.mkv`. Absente ou vide → comportement upstream strict. |

Les chemins sont **ceux vus par Plex** (conteneur Plex), tels qu'affichés dans *Plex → Infos du média*. Variable lue à chaque utilisation : la modifier + redémarrer suffit.

## 3. Règle de décision

- **Film** : une version (`Media`) est exclue si tous ses fichiers (`Part[].file`) sont sous un chemin exclu. Le film est ignoré si **toutes** ses versions sont exclues. Les versions exclues ne comptent pas pour la détection 4K. Une version sans information de fichier est conservée.
- **Série** : ignorée si **tous** ses dossiers (`Location[].path`) sont sous un chemin exclu.

Aucun appel Plex supplémentaire : chemins et dossiers sont dans les réponses déjà demandées par Seerr.

## 4. Implémentation

| Fichier | Contenu |
|---|---|
| `server/lib/plexPathExclusion.ts` | Module sans état : `getExcludedPaths()`, `isExcludedPath()`, `keepNotExcludedVersions()`, `hasOnlyExcludedVersions()`, `isExcludedShow()`. |
| `server/api/plexapi.ts` | Types : `Media.Part[].file`, `PlexMetadata.Location[].path`. |
| `server/lib/scanners/plex/index.ts` | `processPlexMovie()` : film ignoré si toutes ses versions sont exclues, 4K calculé sur les versions gardées. `processPlexShow()` : série ignorée si tous ses dossiers sont exclus (les épisodes du scan récent sont déjà ramenés à leur série). |
| `server/lib/availabilitySync.ts` | `mediaExistsInPlex()` retire les versions exclues et renvoie `excludedTitle` quand rien ne reste (élément considéré absent de Plex, saisons comprises). Radarr/Sonarr restent pris en compte. Si le média n'existe nulle part, `excludedPathResetter()` remplace `mediaUpdater()` (voir §4.1) ; `seasonUpdater()` est alors sauté. |

### 4.1 Remise à zéro (`excludedPathResetter`)

Pour la version concernée (standard ou 4K) :

1. Les demandes *Terminées* sont **rouvertes** (*Approuvées*), ainsi que leurs demandes de saisons *Terminées*. Mise à jour sans listeners TypeORM : une approbation renverrait sinon la demande à Radarr/Sonarr. À l'arrivée du vrai fichier, Seerr les terminera et notifiera normalement.
2. Statut du média : *Demandé* (`PROCESSING`) si une demande approuvée existe (rouverte ou non), *En attente* (`PENDING`) si seule une demande en attente existe, *Inconnu* (`UNKNOWN`) sinon.
3. Saisons *Disponibles* / *Partiellement disponibles* : même règle, à partir des demandes qui couvrent la saison.
4. `ratingKey` vidé (il pointe vers le trailer). Lien Radarr/Sonarr (`serviceId`, `externalServiceId`, slug) conservé si *Demandé*, comme `mediaUpdater()` avec une demande en cours ; vidé sinon.

Pourquoi pas `DELETED` : badge *Supprimé* trompeur, demandes approuvées clôturées par `MediaSubscriber`, passage *En cours* bloqué dans les scans *arr.

Limite acceptée : si Radarr/Sonarr ne suit plus le média, il reste *Demandé* sans avancer (comportement upstream d'une demande approuvée non aboutie).

## 5. Tests

- `plexPathExclusion.test.ts` : parsing de la variable, comparaison par dossier, versions, séries.
- `scanners/plex/plex.test.ts` (créé, absent de main) : sans variable, scan complet (film exclu, film normal, élément fusionné trailer + film), 4K ignoré sur une version exclue, scan récent (films, épisodes), séries.
- `availabilitySync.test.ts` : remise à `UNKNOWN` sans demande (film, série + saisons), fichier Radarr qui garde le film disponible, élément fusionné conservé, sans variable, demande terminée rouverte → *Demandé* sans renvoi à Radarr (film ; série avec saisons demandées / non demandées), demande en attente → *En attente*.

Suite complète, `tsc`, `eslint` et `prettier` propres. Le test « sans renvoi à Radarr » échoue si la demande est rouverte avec les listeners actifs (vérifié).

## 6. Limites

1. Une **série** dont Plex fusionne un dossier normal et un dossier exclu est traitée normalement ; un épisode du trailer peut alors être compté.
2. Retirer un fichier du chemin exclu ne rend pas le média disponible tout seul : il faut un scan Plex (complet pour un fichier ancien).

## 7. Déploiement

1. Ajouter `PLEX_EXCLUDED_PATHS=/media/umtk` au conteneur Seerr.
2. Build : `docker build --build-arg COMMIT_TAG=$(git rev-parse HEAD) …` (sans ça, la popup *Seerr mis à jour* boucle).
3. Lancer *Media Availability Sync* pour remettre à zéro les médias déjà liés à un trailer.
