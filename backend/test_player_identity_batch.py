import unittest
from unittest.mock import patch

from sqlalchemy import event
from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import app  # noqa: E402
import stats_queries  # noqa: E402
from models import Player, PlayerAlias, PlayerFriendCode  # noqa: E402


class PlayerIdentityBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PostgreSQLTestDatabase()
        cls.codes = [f"1000-2000-{index:04d}" for index in range(10)]
        with cls.database.SessionLocal.begin() as session:
            for index, code in enumerate(cls.codes):
                player = Player(canonical_name=f"Player {index}", primary_friend_code=code)
                session.add(player)
                session.flush()
                session.add(PlayerFriendCode(player_id=player.player_id, friend_code=code))
                session.add(
                    PlayerAlias(player_id=player.player_id, alias_type="mii", alias_value="Mii")
                )
                if index == 0:
                    session.add(
                        PlayerFriendCode(player_id=player.player_id, friend_code="2000-3000-4000")
                    )

    @classmethod
    def tearDownClass(cls):
        cls.database.close()

    def setUp(self):
        self.factory_patch = patch.object(stats_queries, "SessionLocal", self.database.SessionLocal)
        self.factory_patch.start()
        self.addCleanup(self.factory_patch.stop)

    def test_ten_players_and_alternate_code_match_single_lookups_in_four_queries(self):
        codes = self.codes + ["2000-3000-4000", "9999-9999-9999", self.codes[0]]
        expected = {code: stats_queries.find_player_identities(friend_code=code) for code in codes}
        statements = []

        def record(_connection, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)

        event.listen(self.database.engine, "before_cursor_execute", record)
        try:
            result = stats_queries.find_player_identities_batch(codes)
        finally:
            event.remove(self.database.engine, "before_cursor_execute", record)
        self.assertEqual(result, expected)
        self.assertEqual(len(statements), 4)
        self.assertTrue(all(statement.lstrip().startswith("SELECT") for statement in statements))

    def test_route_keeps_known_and_unknown_results_without_external_requests(self):
        with patch("routes.public.lookup_mkc_player") as mkc:
            response = app.app.test_client().get(
                "/api/player-identities/batch",
                query_string={"friend_codes": f"{self.codes[0]},9999-9999-9999"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json[self.codes[0]]["results"]), 1)
        self.assertEqual(response.json["9999-9999-9999"], {"reason": "none", "results": []})
        mkc.assert_not_called()

    def test_route_rejects_invalid_and_unbounded_inputs_before_opening_a_session(self):
        for codes in ("", "invalid", "1000-2000-0000," * 24 + "1000-2000-0000"):
            with self.subTest(codes=codes), patch.object(stats_queries, "SessionLocal") as factory:
                response = app.app.test_client().get(
                    "/api/player-identities/batch", query_string={"friend_codes": codes}
                )
                self.assertEqual(response.status_code, 400)
                factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
