from models import (
    Division,
    Player,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Season,
    Team,
    TeamSeasonEntry,
)
from sqlalchemy import desc, select


def list_team_roster_pool(session, league, season, division, team_id):
    league_code = str(league or "").strip().lower()
    season_code = str(season or "").strip().lower()
    division_code = str(division or "").strip().lower()
    if not league_code or not season_code or not division_code or not team_id:
        raise ValueError("League, season, division, and team ID are required.")

    team_entry = session.scalar(
        select(TeamSeasonEntry)
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(
            Season.league_code == league_code,
            Season.season_code == season_code,
            Division.division_code == division_code,
            TeamSeasonEntry.team_id == team_id,
        )
    )
    if team_entry is None:
        return []

    rows = session.execute(
        select(PlayerSeasonEntry, Player)
        .join(Player, Player.player_id == PlayerSeasonEntry.player_id)
        .where(PlayerSeasonEntry.team_season_entry_id == team_entry.team_season_entry_id)
        .order_by(Player.canonical_name, Player.player_id)
    ).all()
    player_ids = [player.player_id for _entry, player in rows]
    friend_codes_by_player = {}
    if player_ids:
        friend_codes = session.scalars(
            select(PlayerFriendCode)
            .where(PlayerFriendCode.player_id.in_(player_ids))
            .order_by(
                PlayerFriendCode.player_id,
                desc(PlayerFriendCode.last_seen_match_id).nulls_last(),
                desc(PlayerFriendCode.player_friend_code_id),
            )
        )
        for friend_code in friend_codes:
            friend_codes_by_player.setdefault(friend_code.player_id, []).append(
                friend_code.friend_code
            )

    return [
        {
            "player_id": player.player_id,
            "player_season_entry_id": entry.player_season_entry_id,
            "canonical_name": player.canonical_name,
            "friend_code": (
                friend_codes_by_player.get(player.player_id, [None])[0]
                or player.primary_friend_code
            ),
            "friend_codes": friend_codes_by_player.get(player.player_id, []),
            "lounge_name": entry.primary_lounge_name,
            "mii_name": entry.primary_mii_name,
            "flag": entry.flag,
        }
        for entry, player in rows
    ]


def list_player_team_memberships(session, league, season, division, player_ids):
    league_code = str(league or "").strip().lower()
    season_code = str(season or "").strip().lower()
    division_code = str(division or "").strip().lower()
    unique_player_ids = sorted(
        {int(player_id) for player_id in (player_ids or []) if int(player_id) > 0}
    )
    if not league_code or not season_code or not division_code:
        raise ValueError("League, season, and division are required.")
    if not unique_player_ids:
        return []

    rows = session.execute(
        select(PlayerSeasonEntry.player_id, TeamSeasonEntry, Team)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == PlayerSeasonEntry.team_season_entry_id,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(
            Season.league_code == league_code,
            Season.season_code == season_code,
            Division.division_code == division_code,
            PlayerSeasonEntry.player_id.in_(unique_player_ids),
        )
        .order_by(
            PlayerSeasonEntry.player_id,
            TeamSeasonEntry.clan_tag,
            Team.team_id,
        )
    ).all()

    memberships = {
        player_id: {"player_id": player_id, "teams": []} for player_id in unique_player_ids
    }
    seen = set()
    for player_id, team_entry, team in rows:
        membership_key = (player_id, team.team_id)
        if membership_key in seen:
            continue
        seen.add(membership_key)
        memberships[player_id]["teams"].append(
            {
                "team_id": team.team_id,
                "canonical_name": team.canonical_name,
                "canonical_tag": team.canonical_tag,
                "display_name": team_entry.display_name,
                "clan_tag": team_entry.clan_tag,
            }
        )

    return [
        memberships[player_id] for player_id in unique_player_ids if memberships[player_id]["teams"]
    ]
