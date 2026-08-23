import os
import threading
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

MKC_PLAYERS_URL = "https://mkcentral.com/api/registry/players"
_thread_local = threading.local()


def _http_session() -> requests.Session:
    session = getattr(_thread_local, "session", None)
    if session is not None:
        return session
    session = requests.Session()
    retry = Retry(
        total=2,
        connect=2,
        read=1,
        status=2,
        backoff_factor=0.25,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    session.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=1, pool_maxsize=1))
    session.headers.update({"User-Agent": "ctc-mkwii-stats/1.0 MKCentral-name-sync"})
    _thread_local.session = session
    return session


def _normalized_friend_code(value: Any) -> str:
    return str(value or "").strip()


def lookup_mkc_player(friend_code: str) -> dict[str, Any]:
    normalized_code = _normalized_friend_code(friend_code)
    if not normalized_code:
        return {"status": "not_found", "friend_code": normalized_code}
    timeout = max(float(os.environ.get("MKC_API_TIMEOUT_SECONDS", "6")), 1.0)
    try:
        response = _http_session().get(
            MKC_PLAYERS_URL,
            params={"friend_code": normalized_code, "detailed": "true"},
            timeout=(min(timeout, 3.05), timeout),
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        return {
            "status": "lookup_failed",
            "friend_code": normalized_code,
            "error": f"MKCentral request failed: {type(error).__name__}",
        }

    player_list = payload.get("player_list") if isinstance(payload, dict) else None
    if not isinstance(player_list, list):
        return {
            "status": "lookup_failed",
            "friend_code": normalized_code,
            "error": "MKCentral returned an unexpected response.",
        }
    exact_matches = []
    for player in player_list:
        if not isinstance(player, dict):
            continue
        codes = player.get("friend_codes")
        if not isinstance(codes, list):
            continue
        if any(
            isinstance(code, dict)
            and _normalized_friend_code(code.get("fc")) == normalized_code
            and str(code.get("type") or "").casefold() == "mkw"
            for code in codes
        ):
            exact_matches.append(player)
    if not exact_matches:
        return {"status": "not_found", "friend_code": normalized_code}
    if len(exact_matches) > 1:
        return {
            "status": "ambiguous",
            "friend_code": normalized_code,
            "error": "MKCentral returned multiple exact Mario Kart Wii profiles.",
            "candidate_ids": [player.get("id") for player in exact_matches],
        }
    player = exact_matches[0]
    name = str(player.get("name") or "").strip()
    mkc_player_id = player.get("id")
    if not name or not isinstance(mkc_player_id, int):
        return {
            "status": "lookup_failed",
            "friend_code": normalized_code,
            "error": "MKCentral returned a profile without a valid player name or ID.",
        }
    return {
        "status": "found",
        "friend_code": normalized_code,
        "mkc_player_id": mkc_player_id,
        "mkc_name": name,
    }
