# Backend

## Technology

The backend is a Flask app using:

- `Flask`
- `Flask-CORS`
- `Flask-Caching`
- `Flask-Compress`
- `pandas`
- `numpy`
- `gunicorn`

Dependencies are listed in `backend/requirements.txt`.

## App Entry Point

The API app is `backend/app.py`.

Local debug mode can be started directly from that file, but deployment uses Gunicorn:

```sh
cd backend
gunicorn app:app
```

The Docker startup script binds Gunicorn to the platform-provided port:

```sh
gunicorn app:app --bind 0.0.0.0:${PORT:-5000}
```

## API Endpoints

### `GET /api/players`

Query params:

- `division`, default `1_2`

Returns a sorted JSON array of player names from the division CSV.

### `GET /api/teams`

Query params:

- `division`, default `1_2`

Returns a sorted JSON array of team names from the division CSV.

### `GET /api/tracks`

Query params:

- `division`, default `1_2`

Returns a sorted JSON array of track names from the division CSV.

### `GET /api/player`

Query params:

- `name`, required
- `season`, optional season code
- `division`, optional division code
- `role`, `runner` or `bagger`; defaults to `runner`

Returns:

```json
{
  "player": "example",
  "role": "runner",
  "results": [
    {
      "track_id": 12,
      "name": "Luigi Circuit",
      "role": "runner",
      "races": 8,
      "scored_races": 8,
      "total_points": 82,
      "points_per_race": 10.25,
      "twelve_race_pace": 123.0,
      "average_placement": 2.5,
      "wins": 3,
      "podiums": 6,
      "podium_rate": 75.0,
      "excluded_score_rows": 0
    }
  ]
}
```

This endpoint returns the selected player's track results for one role. Bagger rows use bagger metrics such as `bag_points`, `bag_point_rate`, and `zero_point_rate` instead of runner pace, win, and podium metrics.

### `GET /api/player-avg`

Query params:

- `name`, required
- `season`, optional season code
- `division`, optional division code
- `role`, `runner` or `bagger`; defaults to `runner`

Returns:

```json
{
  "role": "bagger",
  "player_id": 7,
  "player_name": "example",
  "team_name": "ABC",
  "metrics": {
    "role": "bagger",
    "races": 20,
    "scored_races": 20,
    "total_points": 8,
    "points_per_race": 0.4,
    "bag_points": 8,
    "bag_point_rate": 40.0,
    "zero_points": 12,
    "zero_point_rate": 60.0,
    "average_placement": 9.4,
    "counterpart_races": 14,
    "opponent_point_differential": 2
  }
}
```

The `metrics` object is discriminated by its `role`. Runner metrics include `twelve_race_pace`, wins, and podiums. Bagger metrics report scoring outcomes. A bag point means the bagger scored more than zero points in a race; it does not mean the bagger or team won that race, and it does not measure shock acquisition.

### `GET /api/top-team-players`

Query params:

- `team`, required by behavior but not explicitly validated before helper call
- `min_races`, default `12`
- `season`, optional season code
- `division`, optional division code
- `role`, `runner` or `bagger`; defaults to `runner`

`min_races` must be between 1 and 500. Returns structured player rows with role-discriminated metrics:

```json
[
  {
    "player_id": 7,
    "name": "example",
    "friend_codes": ["0000-0000-0000"],
    "matches": 4,
    "last_appearance": {
      "match_id": 81,
      "season": "s3",
      "division": "d2",
      "week": 7
    },
    "role": "runner",
    "metrics": {
      "role": "runner",
      "races": 48,
      "scored_races": 48,
      "points_per_race": 7.7,
      "twelve_race_pace": 92.4
    }
  }
]
```

### `GET /api/top-team-tracks`

Query params:

- `team`, required by behavior but not explicitly validated before helper call
- `division`, default `1_2`

Returns formatted strings:

```json
["Track - 62.5 pts (4 races)"]
```

### `GET /api/top-tracks`

Query params:

- `track`, required
- `min_races`, default `2`; must be between 1 and 500
- `season`, optional season code
- `division`, optional division code
- `role`, `runner` or `bagger`; defaults to `runner`

Returns structured player ranking rows. Each row includes `player_id`, `name`, `role`, race counts, total points, average placement, and role-specific nullable fields. Runner rows populate `twelve_race_pace`; bagger rows populate `bag_point_rate` and `zero_point_rate`.

Only player-derived analytics use `role`. Team-only endpoints such as `/api/top-team-tracks` and `/api/top-teams-on-track` remain complete team results and never filter points by player role.

### `GET /api/top-teams-on-track`

Query params:

- `track`, required
- `min_races`, default `2`
- `division`, default `1_2`

Returns top teams on a track as formatted strings.

## Helper Modules

### `find.py`

`find.py` provides CSV lookup helpers:

- `findtracklist(csvfile)`
- `findplayernames(csvfile)`
- `findteamnames(csvfile)`

Each helper returns lowercase strings. The API list endpoints do not use these helpers; they read CSVs directly so they can return original capitalization.

### `stats.py`

`stats.py` contains the actual analytics calculations:

- `findplayeravg`
- `findteamavg`
- `findtopteamtracks`
- `findtopplayertracks`
- `findtopteamplayers`
- `findtoptracks`
- `findtopteamsontrack`

Important behavior:

- Track-specific player averages ignore scores above 15.
- Team track averages divide by `len(scorelist) / 5`, assuming 5 players per team.
- Overall player averages use `score * 12 / len(scorelist)`.
- Bagging players are represented by `extract.py` as `player_name + " (bag)"` when an individual race score is `1`.

## Caching

`Flask-Caching` is configured with:

```python
CACHE_TYPE = "simple"
CACHE_DEFAULT_TIMEOUT = 3600
```

Several endpoints cache by query string for one hour. This is useful for performance, but it means newly changed CSV data may not appear immediately in a running process unless the process restarts or the cache expires.

## Known Backend Issues And Risks

- No upload endpoint exists.
- No automatic extraction/rebuild step is wired into Flask.
- `extract.py` writes CSVs but is not called by the API.
- API responses often return formatted strings, forcing frontend parsing in `BestMatchups`.
- `team` is not validated for some endpoints before calling helper functions.
- Errors are returned as HTTP 400 for nearly all exceptions.
- `findteamavg` assumes 5v5 format.
- Current CSV naming supports division, not season.
- Cache invalidation will matter once Season 3 updates are live.
