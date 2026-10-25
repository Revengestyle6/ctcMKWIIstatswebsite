import { expect, type Page, test } from "@playwright/test";
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

type ResultType = NonNullable<MatchJson["result_type"]>;
const baseLabel = "M9 Eç vs [?]";
const resultLabels: Record<ResultType, string> = {
  played: baseLabel,
  free_win: `${baseLabel} — Free win`,
  mutual_tie: `${baseLabel} — Mutual tie`,
};
const played: MatchJson = {
  ...freeWin,
  result_type: "played",
  free_win_winner: undefined,
  match_label: baseLabel,
  races_played: 1,
  tracks: ["Wii Luigi Circuit"],
  rxx: ["original-table"],
  teams: {
    Eç: {
      table_tag_str: "Eç #4F8CFF",
      penalties: 3,
      players: {
        "1111-1111-1111": { mii_name: "Runner A", race_positions: [1], race_scores: [15] },
      },
    },
    "[?]": {
      table_tag_str: "[?] #F45D8C",
      penalties: 5,
      players: {
        "2222-2222-2222": { mii_name: "Runner B", race_positions: [2], race_scores: [12] },
      },
    },
  },
};

function resultDocument(result: ResultType): MatchJson {
  if (result === "played") return played;
  return {
    ...freeWin,
    result_type: result,
    match_label: resultLabels[result],
    free_win_winner: result === "free_win" ? "Eç" : undefined,
    teams: {
      Eç: { ...freeWin.teams?.Eç, total_score: result === "free_win" ? 150 : 0 },
      "[?]": { ...freeWin.teams?.["[?]"], total_score: 0 },
    },
  };
}

async function loadMatch(page: Page, match: MatchJson): Promise<void> {
  await page.route("**/api/admin/matches/1904/management", (route) =>
    route.fulfill({
      json: {
        match,
        source_fingerprint: "original",
        manifest: { match: { label: match.match_label } },
      },
    })
  );
  await page.goto("/json-editor?league=ctc&edit_match=1904");
  await expect(page.getByLabel("Match label, locked", { exact: true })).toHaveValue(
    match.match_label ?? ""
  );
  await expect(page.getByLabel("Result entry")).toHaveValue(match.result_type ?? "played");
}

async function generatedMatch(page: Page): Promise<MatchJson> {
  const text = await page
    .locator("details")
    .filter({ has: page.getByText("Generated JSON Preview", { exact: true }) })
    .locator("pre")
    .textContent();
  return JSON.parse(text ?? "{}");
}

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

for (const from of ["played", "free_win", "mutual_tie"] as const) {
  for (const to of ["played", "free_win", "mutual_tie"] as const) {
    if (from === to) continue;
    test(`${from} → ${to} preserves teams and produces the correct result document`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await loadMatch(page, resultDocument(from));
      await page.getByLabel("Result entry").selectOption(to);
      await expect(page.getByLabel("Result entry")).toHaveValue(to);
      const document = await generatedMatch(page);
      expect(errors).toEqual([]);
      expect(document.result_type).toBe(to);
      expect(document.match_label).toBe(resultLabels[to]);
      expect(document.match_number).toBe(9);
      expect(Object.keys(document.teams ?? {})).toEqual(["Eç", "[?]"]);
      if (to === "played") {
        await expect(page.getByRole("heading", { name: "Race Entry", exact: true })).toBeVisible();
        expect(document.races_played).toBe(12);
        expect(document.free_win_winner).toBeUndefined();
      } else {
        await expect(page.getByRole("heading", { name: "Race Entry", exact: true })).toHaveCount(0);
        expect(document.races_played).toBe(0);
        expect(document.tracks).toEqual([]);
        expect(document.rxx).toEqual([]);
        for (const team of Object.values(document.teams ?? {})) {
          expect(team.players).toEqual({});
          expect(team.penalties).toBe(0);
        }
        expect(document.teams?.Eç?.total_score).toBe(to === "free_win" ? 150 : 0);
        expect(document.teams?.["[?]"]?.total_score).toBe(0);
        expect(document.free_win_winner).toBe(to === "free_win" ? "Eç" : undefined);
        if (to === "free_win") {
          await page.getByLabel("Free-win recipient").selectOption("[?]");
          const secondWinner = await generatedMatch(page);
          expect(secondWinner.free_win_winner).toBe("[?]");
          expect(secondWinner.teams?.["[?]"]?.total_score).toBe(150);
          expect(secondWinner.teams?.Eç?.total_score).toBe(0);
        }
      }
    });
  }
}

for (const intermediate of ["free_win", "mutual_tie"] as const) {
  test(`played → ${intermediate} → played retains the original race data and penalties`, async ({
    page,
  }) => {
    await loadMatch(page, played);
    const before = await generatedMatch(page);
    await page.getByLabel("Result entry").selectOption(intermediate);
    await page.getByLabel("Result entry").selectOption("played");
    expect(await generatedMatch(page)).toEqual(before);
  });
  for (const mode of ["gp", "totals"] as const) {
    test(`unaccounted ${mode} → ${intermediate} → played retains its score entries`, async ({
      page,
    }) => {
      const unaccounted: MatchJson = {
        ...played,
        score_source: "unaccounted",
        entry_mode: mode,
        match_label: `${baseLabel} [Unaccounted · ${mode === "gp" ? "GP" : "totals"}]`,
        tracks: [],
        teams: Object.fromEntries(
          Object.entries(played.teams ?? {}).map(([key, team]) => [
            key,
            {
              ...team,
              players: Object.fromEntries(
                Object.entries(team.players ?? {}).map(([fc, player]) => [
                  fc,
                  {
                    ...player,
                    aggregate_scores: [
                      {
                        gp_number: mode === "gp" ? 1 : 0,
                        role: "runner",
                        points: 15,
                        races: 1,
                        disconnection_points: 0,
                      },
                    ],
                  },
                ])
              ),
            },
          ])
        ),
      };
      await loadMatch(page, unaccounted);
      const before = await generatedMatch(page);
      await page.getByLabel("Result entry").selectOption(intermediate);
      const special = await generatedMatch(page);
      expect(special.match_label).toBe(resultLabels[intermediate]);
      expect(special.score_source).toBe("accounted");
      expect(special.entry_mode).toBeUndefined();
      expect(special.races_played).toBe(0);
      for (const team of Object.values(special.teams ?? {})) expect(team.players).toEqual({});
      await page.getByLabel("Result entry").selectOption("played");
      expect(await generatedMatch(page)).toEqual(before);
    });
  }
}

for (const intermediate of ["played", "mutual_tie"] as const) {
  test(`free win → ${intermediate} → free win keeps the selected second-team recipient`, async ({
    page,
  }) => {
    await loadMatch(page, { ...resultDocument("free_win"), free_win_winner: "[?]" });
    const before = await generatedMatch(page);
    await page.getByLabel("Result entry").selectOption(intermediate);
    await page.getByLabel("Result entry").selectOption("free_win");
    await expect(page.getByLabel("Free-win recipient")).toHaveValue("[?]");
    expect(await generatedMatch(page)).toEqual(before);
  });
}
