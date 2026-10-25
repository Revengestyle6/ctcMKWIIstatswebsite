import { expect, test } from "@playwright/test";
import {
  compileMatch,
  type MatchJson,
  normalizeMatchForEditor,
} from "../src/features/match-editor/matchJsonEditorModel";

const freeWin: MatchJson = {
  league: "ctc",
  season: "s4",
  division: "d2",
  match_number: 9,
  match_type: "regular",
  match_label: "M9 Eç vs [?] — Free win",
  result_type: "free_win",
  score_source: "accounted",
  format: "5v5",
  races_played: 0,
  tracks: [],
  rxx: [],
  free_win_winner: "TeamA",
  teams: {
    Eç: { table_tag_str: "Eç #4F8CFF", total_score: 150, players: {} },
    "[?]": { table_tag_str: "[?] #F45D8C", total_score: 0, players: {} },
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({
        json: {
          authenticated: true,
          admin: { admin_user_id: 1, email: "owner@example.com", role: "owner" },
        },
      });
    if (path === "/api/admin/matches/1904/management")
      return route.fulfill({
        json: {
          match: freeWin,
          source_fingerprint: "original",
          manifest: { match: { label: freeWin.match_label } },
        },
      });
    if (path === "/api/match-scopes")
      return route.fulfill({ json: [{ league: "ctc", season: "s4", division: "d2" }] });
    return route.fulfill({ json: [] });
  });
});

test("loading an accepted free win restores its recipient", async ({ page }) => {
  await page.goto("/json-editor?league=ctc&edit_match=1904");
  await expect(page.getByLabel("Free-win recipient")).toHaveValue("Eç");
  await expect(page.getByLabel("Team name or tag", { exact: true }).first()).toHaveValue("Eç");
});

test("an accepted free win can become a played match without crashing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/json-editor?league=ctc&edit_match=1904");
  await expect(page.getByLabel("Result entry")).toHaveValue("free_win");
  await page.getByLabel("Result entry").selectOption("played");
  await expect(page.getByRole("heading", { name: "Race Entry", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.getByLabel("Team name or tag", { exact: true }).first()).toHaveValue("Eç");
});

test("compiling a free win keeps the recipient aligned with serialized team keys", () => {
  const draft: MatchJson = {
    ...freeWin,
    teams: { TeamA: freeWin.teams?.Eç ?? {}, TeamB: freeWin.teams?.["[?]"] ?? {} },
  };
  const compiled = compileMatch(draft, []);
  expect(compiled.free_win_winner).toBe("Eç");
  expect(compiled.teams?.Eç?.total_score).toBe(150);
  expect(compileMatch(compiled, [])).toEqual(compiled);
});

test("an explicit second-team recipient survives compilation", () => {
  const compiled = compileMatch(
    {
      ...freeWin,
      free_win_winner: "TeamB",
      teams: { TeamA: freeWin.teams?.Eç ?? {}, TeamB: freeWin.teams?.["[?]"] ?? {} },
    },
    []
  );
  expect(compiled.free_win_winner).toBe("[?]");
  expect(compiled.teams?.["[?]"]?.total_score).toBe(150);
  expect(compiled.teams?.Eç?.total_score).toBe(0);
});

test("ambiguous legacy scores do not select a recipient", () => {
  const ambiguous = {
    ...freeWin,
    teams: { Eç: { total_score: 150 }, "[?]": { total_score: 150 } },
  };
  expect(normalizeMatchForEditor(ambiguous).free_win_winner).toBeUndefined();
});

test("a loaded mutual tie can become a played match", async ({ page }) => {
  await page.route("**/api/admin/matches/1904/management", (route) =>
    route.fulfill({
      json: {
        match: { ...freeWin, result_type: "mutual_tie", match_label: "M9 Eç vs [?] — Mutual tie" },
        source_fingerprint: "original",
        manifest: { match: { label: "M9 Eç vs [?] — Mutual tie" } },
      },
    })
  );
  await page.goto("/json-editor?league=ctc&edit_match=1904");
  await expect(page.getByLabel("Result entry")).toHaveValue("mutual_tie");
  await page.getByLabel("Result entry").selectOption("played");
  await expect(page.getByRole("heading", { name: "Race Entry", exact: true })).toBeVisible();
});
