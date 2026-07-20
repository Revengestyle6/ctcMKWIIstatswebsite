"""Compatibility facade for player and team dashboard analytics."""

from player_dashboard_stats import (
    DashboardError,
    DashboardNotFound,
    DashboardScope,
    get_player_overview,
    get_player_performance,
    get_player_tracks,
    get_track_player_rankings,
)
from player_role_analytics import bagger_counterpart_summary
from team_dashboard_stats import (
    _bulk_bagger_counterpart_summaries,
    get_team_overview,
    get_team_roster,
    get_team_tracks,
)

__all__ = [
    "DashboardError",
    "DashboardNotFound",
    "DashboardScope",
    "_bulk_bagger_counterpart_summaries",
    "bagger_counterpart_summary",
    "get_player_overview",
    "get_player_performance",
    "get_player_tracks",
    "get_team_overview",
    "get_team_roster",
    "get_team_tracks",
    "get_track_player_rankings",
]
