import { expect, test } from "@playwright/test";
import type { MatchScope, PlayoffSeriesResponse, TeamScope } from "../src/api";
import type { MatchJson } from "../src/features/match-editor/matchJsonEditorModel";
import {
  findTeamScope,
  playoffConsistencyIssues,
  validation,
} from "../src/features/match-editor/matchJsonEditorValidation";

const teams: TeamScope[] = ["A", "B", "C"].map((suffix, index) => ({
  league: "gsc",
  season: "s16",
  division: "d1",
  team_id: 10,
  team_season_entry_id: index + 101,
  canonical_tag: "Jx.",
  canonical_name: "Jinx",
  clan_tag: `Jx.${suffix}`,
  display_name: `Jinx ${suffix}`,
  competition_status: "active",
  competition_status_note: null,
}));
const scope: MatchScope = {
  league: "gsc",
  season: "s16",
  division: "d1",
  season_name: "GSC Season 16",
  division_name: "Division 1",
};
const document: MatchJson = {
  league: "gsc",
  season: "s16",
  division: "d1",
  match_number: 1,
  format: "5v5",
  result_type: "free_win",
  free_win_winner: "Jx.A",
  races_played: 0,
  tracks: [],
  teams: {
    "Jx.A": { table_tag_str: "Jx.A", total_score: 150, players: {} },
    "Jx.B": { table_tag_str: "Jx.B", total_score: 0, players: {} },
  },
};

test("distinct entries under one canonical team can oppose each other", () => {
  const issues = validation(document, [], {}, [scope], true, teams, true, [], true, [], {});
  expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
  expect(findTeamScope(teams, "jx.b")?.team_season_entry_id).toBe(102);
  expect(findTeamScope(teams, "Jinx B")?.team_season_entry_id).toBe(102);
  expect(findTeamScope(teams, "Jx.")).toBeUndefined();
  expect(findTeamScope(teams, "Jinx")).toBeUndefined();
});

test("two aliases of the same season entry cannot oppose each other", () => {
  const sameEntry = {
    ...document,
    teams: { ...document.teams, "Jx.B": { ...document.teams?.["Jx.B"], table_tag_str: "Jinx A" } },
  };
  const issues = validation(sameEntry, [], {}, [scope], true, teams, true, [], true, [], {});
  expect(
    issues.some((issue) => issue.level === "error" && issue.message.includes("same season entry"))
  ).toBe(true);
});

test("playoff pairing distinguishes siblings with identical canonical IDs", () => {
  const match: MatchJson = {
    ...document,
    match_type: "playoff",
    playoff_stage: "semifinals",
    playoff_series_number: 1,
    series_match_number: 2,
    best_of: 3,
  };
  const context: PlayoffSeriesResponse = {
    season: "s16",
    division: "d1",
    format: null,
    series: [
      {
        playoff_series_id: 1,
        stage: "semifinals",
        series_number: 1,
        label: "Semifinals Series 1",
        best_of: 3,
        status: "in_progress",
        winner_team_id: null,
        winner_team_season_entry_id: null,
        participants: teams.slice(0, 2).map((team, index) => ({
          team_id: team.team_id,
          team_season_entry_id: team.team_season_entry_id,
          name: team.display_name,
          tag: team.clan_tag,
          slot: index + 1,
          wins: index === 0 ? 1 : 0,
        })),
        matches: [{ match_id: 1, series_match_number: 1, label: "Match 1" }],
      },
    ],
  };
  expect(playoffConsistencyIssues(match, teams, context, true)).toEqual([]);
  const wrongSibling = {
    ...match,
    teams: {
      "Jx.A": document.teams?.["Jx.A"] ?? {},
      "Jx.C": { table_tag_str: "Jx.C", total_score: 0, players: {} },
    },
  };
  expect(
    playoffConsistencyIssues(wrongSibling, teams, context, true).some((issue) =>
      issue.message.includes("locked to")
    )
  ).toBe(true);
});

test("editor team pool permits a sibling while keeping the occupied entry disabled", async ({
  page,
}) => {
  await page.route("**/api/team-scopes", (route) => route.fulfill({ json: teams }));
  await page.route("**/api/match-scopes", (route) => route.fulfill({ json: [scope] }));
  await page.goto("/json-editor?league=gsc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "siblings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  const first = page.locator('[data-team-key="Jx.A"]');
  const second = page.locator('[data-team-key="Jx.B"]');
  await second.getByRole("button", { name: "Season team pool" }).click();
  await expect(
    second.locator('[data-team-scope-id="102"]').getByRole("button", { name: "Selected" })
  ).toBeDisabled();
  await expect(
    second.locator('[data-team-scope-id="101"]').getByRole("button", { name: "In match" })
  ).toBeDisabled();
  const third = second
    .locator('[data-team-scope-id="103"]')
    .getByRole("button", { name: "Use team" });
  await expect(third).toBeEnabled();
  await third.click();
  await expect(second.locator('input[list="team-scope-options"]')).toHaveValue("Jx.C");
  await first.getByRole("button", { name: "Season team pool" }).click();
  await expect(
    first.locator('[data-team-scope-id="102"]').getByRole("button", { name: "Use team" })
  ).toBeEnabled();
});

test("registration form allows another entry of a team already in the division", async ({
  page,
}) => {
  const canonical = {
    id: 10,
    canonical_name: "Jinx",
    canonical_tag: "Jx.",
    league_identities: [{ league: "gsc", tag: "Jx." }],
  };
  const division = {
    id: 1,
    code: "d1",
    name: "Division 1",
    is_conference_based: false,
    conferences: [],
    playoff_team_count: 3,
  };
  const season = {
    id: 16,
    league: "gsc",
    code: "s16",
    number: 16,
    name: "GSC Season 16",
    status: "upcoming",
    starts_on: null,
    ends_on: null,
    divisions: [division],
  };
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        admin: { admin_user_id: 1, email: "owner@example.com", role: "owner" },
      },
    })
  );
  await page.route("**/api/admin/competition-setup?*", (route) =>
    route.fulfill({
      json: {
        league: "gsc",
        seasons: [season],
        teams: [canonical],
        entries: [
          {
            id: 101,
            team: canonical,
            season,
            division,
            display_name: "Jinx A",
            clan_tag: "Jx.A",
            hex_color: null,
            competition_status: "active",
            conference: null,
          },
        ],
      },
    })
  );
  await page.route("**/api/admin/teams/10/logos", (route) =>
    route.fulfill({ json: { team: canonical, logos: [] } })
  );
  await page.goto("/admin/aliases?league=gsc");
  const form = page
    .getByRole("heading", { name: "Register a team for a division" })
    .locator("xpath=ancestor::form[1]");
  await form.getByRole("combobox", { name: "Season", exact: true }).selectOption("16");
  await form.getByLabel(/^Division/).selectOption("1");
  await form.getByRole("combobox", { name: "Team", exact: true }).selectOption("10");
  await form.getByLabel(/^Season display name/).fill("Jinx A");
  await form.getByLabel(/^Season tag/).fill("Jx.A");
  await expect(form.getByRole("button", { name: "Register team", exact: true })).toBeDisabled();
  await form.getByLabel(/^Season display name/).fill("Jinx B");
  await form.getByLabel(/^Season tag/).fill("Jx.B");
  await expect(form.getByRole("button", { name: "Register team", exact: true })).toBeEnabled();
});
