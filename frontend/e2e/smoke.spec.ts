import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/stats",
  "/standings",
  "/top-team-players",
  "/top-tracks",
  "/best-matchups",
  "/matches",
  "/players/180",
  "/teams/41",
  "/json-editor",
  "/database-health",
  "/admin/access",
  "/admin/aliases",
  "/admin/review-queue",
];

test("standings renders the synchronized competition sections", async ({ page }) => {
  await page.goto("/standings?league=gsc&season=s15&division=d1");
  await expect(page.getByRole("heading", { name: "League Table" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Player GP Average" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Head-to-Head Results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Playoff Bracket" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Eligible players" })).toBeVisible();
  await expect(page.getByRole("button", { name: "All players" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Running points" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bagging points" })).toBeVisible();
  await expect(page.getByTitle("Player GPs played / team GPs played")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Competition Status" })).toHaveCount(0);
});

test("signed-in administrators can update a team competition status from standings", async ({
  page,
}) => {
  let submittedStatus = "";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        admin: { admin_user_id: 1, email: "admin@example.com", role: "admin" },
      }),
    })
  );
  await page.route("**/api/admin/team-season-entries/*/status", async (route) => {
    const payload = route.request().postDataJSON() as { status: string; note: string };
    submittedStatus = payload.status;
    const entryId = Number(
      route
        .request()
        .url()
        .match(/entries\/(\d+)\/status/)?.[1] ?? 0
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        team_season_entry_id: entryId,
        status: payload.status,
        note: payload.note || null,
      }),
    });
  });

  await page.goto("/standings?league=gsc&season=s15&division=d1");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team Competition Status" })).toBeVisible();
  await page.getByLabel("Status").selectOption("dropped");
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Competition status saved")).toBeVisible();
  expect(submittedStatus).toBe("dropped");
});

test("alias manager updates a selected team season entry through the shared status control", async ({
  page,
}) => {
  let submittedStatus = "";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        admin: { admin_user_id: 1, email: "admin@example.com", role: "admin" },
      }),
    })
  );
  await page.route("**/api/admin/aliases/tracks*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/admin/aliases/teams*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, label: "TT — Test Team", secondary: "TT", alias_count: 0 }]),
    })
  );
  await page.route("**/api/admin/aliases/teams/1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        label: "TT — Test Team",
        canonical_name: null,
        secondary: "TT",
        alias_types: ["alias"],
        aliases: [],
        friend_codes: [],
        season_entries: [],
      }),
    })
  );
  await page.route("**/api/admin/teams/1/identity", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        team: {
          id: 1,
          canonical_name: "Test Team",
          canonical_tag: "TT",
          canonical_identity_override: false,
          canonical_league_preference: null,
        },
        league_identities: [],
        season_entries: [
          {
            id: 12,
            season: {
              id: 3,
              league: "gsc",
              code: "s3",
              name: "Season 3",
              season_number: 3,
            },
            division: { id: 4, code: "d1", name: "Division 1" },
            display_name: "Test Team",
            clan_tag: "TT",
            competition_status: "active",
            competition_status_note: null,
          },
        ],
      }),
    })
  );
  await page.route("**/api/admin/team-season-entries/12/status", async (route) => {
    const payload = route.request().postDataJSON() as { status: string; note: string };
    submittedStatus = payload.status;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        team_season_entry_id: 12,
        status: payload.status,
        note: payload.note || null,
      }),
    });
  });

  await page.goto("/admin/aliases?league=gsc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();
  await page.getByRole("tab", { name: "Teams" }).click();
  await page.getByRole("button", { name: /TT — Test Team/ }).click();
  const statusPanel = page
    .getByRole("heading", { name: "Team Competition Status", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(statusPanel).toBeVisible();
  const statusSelects = statusPanel.locator("select");
  await expect(statusSelects.first().locator("option:checked")).toHaveText(/GSC S3 D1/);
  await statusSelects.nth(1).selectOption("disqualified");
  await statusPanel.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Competition status saved")).toBeVisible();
  expect(submittedStatus).toBe("disqualified");
});

test("review queue uses the match label instead of the uploaded filename", async ({ page }) => {
  const submission = {
    submission_id: "submission-1",
    status: "pending",
    original_filename: "uploaded-table.json",
    match_label: "M7 Alpha vs Beta",
    submitted_at: "2026-08-30T12:00:00Z",
    warnings: [],
    claimed_by_admin_user_id: null,
    decision_note: null,
    accepted_match_id: null,
  };
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        admin: { admin_user_id: 1, email: "admin@example.com", role: "admin" },
      }),
    })
  );
  await page.route("**/api/admin/review-submissions/submission-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...submission,
        match: { league: "gsc", match_label: submission.match_label },
      }),
    })
  );
  await page.route("**/api/admin/review-submissions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([submission]),
    })
  );

  await page.goto("/admin/review-queue?league=gsc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();
  await expect(page.getByText("uploaded-table.json")).toHaveCount(0);
  await page.getByRole("button", { name: /M7 Alpha vs Beta/ }).click();
  await expect(page.getByRole("heading", { name: "M7 Alpha vs Beta" })).toBeVisible();
  await expect(page.getByText("uploaded-table.json")).toHaveCount(0);
});

test("json editor creates a metadata-only free win", async ({ page }) => {
  await page.route("**/api/team-scopes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          league: "gsc",
          season: "s15",
          division: "d1",
          team_id: 11,
          canonical_name: "Eleven Stars",
          canonical_tag: "XI",
          display_name: "Eleven Stars",
          clan_tag: "XI",
          team_season_entry_id: 111,
          competition_status: "active",
          competition_status_note: null,
        },
        {
          league: "gsc",
          season: "s15",
          division: "d1",
          team_id: 12,
          canonical_name: "Yellow Star League",
          canonical_tag: "YSL",
          display_name: "Yellow Star League",
          clan_tag: "YSL",
          team_season_entry_id: 112,
          competition_status: "active",
          competition_status_note: null,
        },
        {
          league: "gsc",
          season: "s15",
          division: "d1",
          team_id: 13,
          canonical_name: "Nova Racing",
          canonical_tag: "NR",
          display_name: "Nova Racing",
          clan_tag: "NR",
          team_season_entry_id: 113,
          competition_status: "active",
          competition_status_note: null,
        },
      ]),
    })
  );
  await page.goto("/json-editor?league=gsc");
  const dismissWelcome = page.getByRole("button", { name: "No Thanks", exact: true });
  await dismissWelcome.click();
  const match = {
    league: "gsc",
    season: "s15",
    division: "d1",
    match_type: "regular",
    result_type: "free_win",
    free_win_winner: "XI",
    match_number: 99,
    races_played: 0,
    tracks: [],
    teams: {
      XI: {
        table_tag_str: "XI #ffffff",
        table_penalty_str: "Penalty -10",
        hex_color: "#ffffff",
        penalties: 10,
        players: {},
      },
      YSL: { table_tag_str: "YSL #eeee00", hex_color: "#eeee00", players: {} },
    },
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "free-win.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });
  await expect(page.getByLabel("Result entry")).toHaveValue("free_win");
  await expect(page.getByRole("heading", { name: "Race Entry" })).toHaveCount(0);
  await expect(page.getByLabel("Penalty", { exact: true })).toHaveCount(0);
  const xiTeam = page.locator('[data-team-key="XI"]');
  const xiTeamIdentity = xiTeam.locator('input[list="team-scope-options"]');
  await xiTeamIdentity.fill("Eleven Stars");
  await expect(xiTeamIdentity).toHaveValue("XI");
  const yslTeam = page.locator('[data-team-key="YSL"]');
  await yslTeam.getByRole("button", { name: "Season team pool" }).click();
  await yslTeam
    .locator('[data-team-scope-id="113"]')
    .getByRole("button", { name: "Use team" })
    .click();
  await expect(yslTeam.locator('input[list="team-scope-options"]')).toHaveValue("NR");
  await xiTeam.getByRole("button", { name: "Season team pool" }).click();
  await expect(
    xiTeam.locator('[data-team-scope-id="113"]').getByRole("button", { name: "In match" })
  ).toBeDisabled();
  await page.getByText("Generated JSON Preview").click();
  const compiled = JSON.parse((await page.locator("details pre").textContent()) ?? "{}");
  expect(compiled.races_played).toBe(0);
  expect(compiled.tracks).toEqual([]);
  expect(compiled.teams.XI.total_score).toBe(150);
  expect(compiled.teams.XI.penalties).toBe(0);
  expect(compiled.teams.XI.table_penalty_str).toBeUndefined();
  expect(compiled.teams.NR.total_score).toBe(0);
  expect(compiled.teams.XI.players).toEqual({});
});

test("GSC receives the correct favicon before React boots", async ({ page }) => {
  await page.route("**/src/index.tsx", (route) => route.abort());
  await page.goto("/?league=gsc");

  const favicon = page.locator("#league-favicon");
  await expect(favicon).toHaveAttribute("data-league", "gsc");
  await expect(favicon).toHaveAttribute("type", "image/png");
  await expect(favicon).toHaveAttribute("href", /\/media\/leagues\/gsc\/branding\/favicon\.png$/);
});

test("a new visit defaults to GSC", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");

  await expect(page).toHaveURL(/\?league=gsc$/);
  const selector = page.getByRole("group", { name: "Select league" });
  await expect(selector.locator("button").first()).toHaveAttribute("aria-label", "GSC");
  await expect(page.getByRole("button", { name: "GSC", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("league switch replaces the browser-tab icon", async ({ page }) => {
  await page.goto("/?league=ctc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();
  const ctcSelector = page.getByRole("button", { name: "CTC", exact: true });
  const gscSelector = page.getByRole("button", { name: "GSC", exact: true });
  await expect(
    page.getByRole("group", { name: "Select league" }).locator("button").first()
  ).toHaveAttribute("aria-label", "GSC");
  await expect(ctcSelector.getByRole("img")).toHaveAttribute(
    "src",
    "/media/leagues/ctc/branding/logo.webp"
  );
  await expect(gscSelector.getByRole("img")).toHaveAttribute(
    "src",
    "/media/leagues/gsc/branding/logo.webp"
  );
  await expect(ctcSelector).toHaveClass(/opacity-100/);
  await expect(gscSelector).toHaveClass(/opacity-35/);

  const ctcFavicon = page.locator("#league-favicon");
  await expect(ctcFavicon).toHaveAttribute("data-league", "ctc");
  await expect(ctcFavicon).toHaveAttribute("href", /\/media\/leagues\/ctc\/branding\/logo\.webp$/);

  await gscSelector.click();
  await expect(ctcSelector).toHaveClass(/opacity-35/);
  await expect(gscSelector).toHaveClass(/opacity-100/);
  const gscFavicon = page.locator("#league-favicon");
  await expect(gscFavicon).toHaveAttribute("data-league", "gsc");
  await expect(gscFavicon).toHaveAttribute(
    "href",
    /\/media\/leagues\/gsc\/branding\/favicon\.png$/
  );
  await expect(gscFavicon).toHaveAttribute("type", "image/png");

  await ctcSelector.click();
  await expect(page.locator("#league-favicon")).toHaveAttribute("data-league", "ctc");
});

test("inner-page league switch is placed beside the active league logo", async ({ page }) => {
  await page.goto("/matches?league=ctc&season=s3&division=d1");

  const switcher = page.getByRole("group", { name: "League", exact: true });
  await expect(switcher).toBeVisible();
  await expect(switcher).not.toHaveClass(/fixed/);
  await expect(switcher.locator("..").getByRole("link", { name: "CTC home" })).toBeVisible();
});

test("administrator access has a league-themed Back link", async ({ page }) => {
  await page.goto("/admin/access?league=gsc");

  const backLink = page.getByRole("link", { name: "Back", exact: true });
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveAttribute("href", "/?league=gsc");
  await expect(backLink).toHaveClass(/league-accent-text/);
  await expect(backLink).toHaveCSS("color", "rgb(251, 191, 36)");
});

for (const route of routes) {
  test(`${route} loads`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok(), `${route} should return a successful document`).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
  });
}

test("team track minimum-races control stays interactive while results refresh", async ({
  page,
}) => {
  let markRefreshStarted: () => void = () => {};
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });

  await page.route("**/api/teams/41/overview**", async (route) => {
    const minimumRaces = new URL(route.request().url()).searchParams.get("min_races");
    if (minimumRaces === "3") {
      markRefreshStarted();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await route.continue();
  });

  await page.goto("/teams/41?tab=tracks");
  const minimumRaces = page.getByLabel("Minimum races");
  await expect(minimumRaces).toHaveValue("2");

  await minimumRaces.press("ArrowUp");
  await refreshStarted;

  await expect(minimumRaces).toHaveValue("3");
  await expect(minimumRaces).toBeEnabled();
});

test("authorized JSON editor users can upload directly or submit to the review queue", async ({
  page,
}) => {
  let reviewSubmissionPath = "";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        admin: { admin_user_id: 1, email: "owner@example.com", role: "owner" },
      }),
    })
  );
  await page.route(/\/api\/(?:admin\/)?review-submissions$/, (route) => {
    reviewSubmissionPath = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        receipt: "admin-queued-receipt",
        status: "pending",
        submitted_at: "2026-08-09T12:00:00Z",
        updated_at: "2026-08-09T12:00:00Z",
        expires_at: "2026-09-08T12:00:00Z",
      }),
    });
  });
  await page.goto("/json-editor?league=ctc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team Competition Status" })).toHaveCount(0);
  await page
    .locator('input[type="file"]')
    .setInputFiles("../backend/JSON/ctc/s3/d2/W11 [M11] sts 366 - 356 CS.json");

  await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();

  await expect(page.getByRole("button", { name: "Submit to review queue" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Confirm upload" })).toBeEnabled();
  await expect(
    page.getByText(
      "Upload this match now, or submit it to the review queue without changing analytics."
    )
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Submit to review queue" }).click();
  await expect(page.getByText("Submitted for administrator review.")).toBeVisible();
  expect(reviewSubmissionPath).toBe("/api/admin/review-submissions");
});

test("match history loads regular-season data directly after all matches", async ({ page }) => {
  await page.goto("/matches?league=ctc&season=s3&division=d1&match_set=all");
  const dismissWelcome = page.getByRole("button", { name: "No Thanks", exact: true });
  await dismissWelcome.click();

  const matchSelection = page.getByLabel("Match", { exact: true });
  await expect(matchSelection).toBeEnabled();
  const firstRegularMatch = matchSelection
    .locator("option")
    .filter({ hasText: /^W\d+ - / })
    .first();
  const firstRegularMatchId = await firstRegularMatch.getAttribute("value");
  expect(firstRegularMatchId).not.toBeNull();
  await matchSelection.selectOption(firstRegularMatchId ?? "");
  await expect(page.getByText(/S3 \/ D1 \/ Match \d+/)).toBeVisible();

  await page.getByRole("button", { name: "Regular season", exact: true }).click();

  await expect(page).not.toHaveURL(/match_set=/);
  await expect(matchSelection).toBeEnabled();
  await expect(matchSelection.locator("option:checked")).toHaveText(/^W\d+ - /);
  await expect(page.getByText(/S3 \/ D1 \/ Match \d+/)).toBeVisible();
});

test("json editor changes a misplaced player's team and deletes the accidental team", async ({
  page,
}) => {
  await page.goto("/json-editor");
  await page.getByRole("button", { name: "No Thanks" }).click();
  const match = {
    title_str: "#title 2 races\n",
    format: "5v5",
    races_played: 2,
    league: "ctc",
    season: "s3",
    division: "d2",
    match_number: 1,
    match_label: "Team deletion test",
    rxx: ["r12345678"],
    tracks: ["Luigi Circuit", "Moo Moo Meadows"],
    teams: Object.fromEntries(
      ["Alpha", "Beta", "Extra"].map((tag, index) => [
        tag,
        {
          table_tag_str: `${tag} #${["4F8CFF", "F45D8C", "22C55E"][index]}`,
          hex_color: `#${["4F8CFF", "F45D8C", "22C55E"][index]}`,
          penalties: 0,
          players: {
            [`0000-0000-000${index}`]: {
              lounge_name: `${tag} player`,
              table_name: `${tag} player`,
              mii_name: `${tag} Mii`,
              tag,
              race_positions: index === 2 ? [3, null] : [index + 1, index + 1],
              race_scores: index === 2 ? [10, 3] : [15 - index * 3, 15 - index * 3],
              race_roles: index === 2 ? ["runner", "bagger"] : ["runner", "runner"],
            },
          },
        },
      ])
    ),
  };

  await page.locator('input[type="file"]').setInputFiles({
    name: "three-team-match.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });

  const teamsSection = page.locator("section").filter({ hasText: "Teams And Players" });
  await expect(teamsSection.locator("article")).toHaveCount(3);
  await expect(
    page.getByText("5v5 matches cannot have more than 2 teams (found 3).")
  ).toBeVisible();
  await expect(
    page.getByText("This match contains 2 races instead of the usual 12.")
  ).toBeVisible();

  const alphaTeam = page.locator('[data-team-key="Alpha"]');
  const extraTeam = page.locator('[data-team-key="Extra"]');
  const extraPlayer = page.locator('[data-player-key="Extra::0000-0000-0002"]');

  await extraPlayer.getByText("Change Team", { exact: true }).click();
  await extraPlayer.getByRole("button", { name: "Alpha", exact: true }).click();
  await expect(alphaTeam).toContainText("Extra player");
  await expect(extraTeam).not.toContainText("Extra player");

  await page.getByText("Generated JSON Preview").click();
  const generatedJson = page.locator("details pre");
  const movedMatch = JSON.parse((await generatedJson.textContent()) ?? "{}");
  expect(movedMatch.teams.Alpha.players["0000-0000-0002"].race_positions).toEqual([3, null]);
  expect(movedMatch.teams.Alpha.players["0000-0000-0002"].race_scores).toEqual([10, 3]);
  expect(movedMatch.teams.Alpha.players["0000-0000-0002"].race_roles).toEqual(["runner", "bagger"]);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete team Extra?");
    expect(dialog.message()).toContain("0 players");
    await dialog.accept();
  });
  await page.getByTitle("Delete team Extra").click();
  await expect(teamsSection.locator("article")).toHaveCount(2);
  await expect(
    page.getByText("5v5 matches cannot have more than 2 teams (found 3).")
  ).not.toBeVisible();

  await expect(generatedJson).toContainText('"Alpha"');
  await expect(generatedJson).toContainText('"Beta"');
  await expect(generatedJson).not.toContainText('"Extra"');
});

test("json editor flags missing required metadata before review", async ({ page }) => {
  await page.goto("/json-editor?league=ctc");
  await page.getByRole("button", { name: "No Thanks" }).click();
  const match = {
    title_str: "#title 2 races\n",
    format: "5v5",
    races_played: 2,
    league: "",
    season: "",
    division: "",
    match_label: "",
    rxx: ["r12345678"],
    tracks: ["Luigi Circuit", "Moo Moo Meadows"],
    teams: {},
  };

  await page.locator('input[type="file"]').setInputFiles({
    name: "missing-metadata.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });

  await expect(page.getByText("Season is missing.")).toBeVisible();
  await expect(page.getByText("Division is missing.")).toBeVisible();
  await expect(
    page.getByText("Match number is required and must be a positive whole number.")
  ).toBeVisible();
  await expect(
    page.getByText("This match contains 2 races instead of the usual 12.")
  ).toBeVisible();
  await expect(page.locator('[data-required-marker="true"]')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Review & Upload" }).first()).toBeDisabled();

  const metadata = page.locator("section").filter({ hasText: "Additional Metadata" });
  await metadata.getByRole("combobox", { name: /^season required/i }).fill("s3");
  await metadata.getByRole("combobox", { name: /^division required/i }).fill("d2");
  await metadata.getByRole("spinbutton", { name: /^match number required/i }).fill("1");

  await expect(metadata.getByLabel("Match label")).toHaveValue("M1");
  await expect(page.locator('[data-required-marker="true"]')).toHaveCount(0);
  await expect(
    page.getByText("This match contains 2 races instead of the usual 12.")
  ).toBeVisible();
});

test("json editor ignores positionless substitution artifacts when every racer finished", async ({
  page,
}) => {
  await page.goto("/json-editor?league=ctc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();

  const scoreByPosition = [15, 12, 10, 8, 6, 4, 3, 2, 1, 0];
  const player = (name: string, positions: Array<number | null>, scores: number[]) => ({
    table_str: name,
    mii_name: name,
    lounge_name: name,
    table_name: name,
    tag: name.startsWith("Beta") ? "Beta" : "Alpha",
    total_score: scores.reduce((total, score) => total + score, 0),
    had_penalties: false,
    penalties: 0,
    subbed_out: positions[0] !== null && positions[1] === null,
    race_scores: scores,
    race_positions: positions,
  });
  const alphaPlayers = {
    "0000-0000-0001": player("Outgoing", [1, null], [15, 3]),
    "0000-0000-0002": {
      ...player("Incoming", [null, 1], [15, 15]),
      table_name: "Outgoing(1)/Incoming(1)",
    },
    ...Object.fromEntries(
      [2, 3, 4, 5].map((position) => [
        `0000-0000-${String(position + 1).padStart(4, "0")}`,
        player(
          `Alpha ${position}`,
          [position, position],
          [scoreByPosition[position - 1], scoreByPosition[position - 1]]
        ),
      ])
    ),
  };
  const betaPlayers = Object.fromEntries(
    [6, 7, 8, 9, 10].map((position) => [
      `0000-0000-${String(position + 1).padStart(4, "0")}`,
      player(
        `Beta ${position}`,
        [position, position],
        [scoreByPosition[position - 1], scoreByPosition[position - 1]]
      ),
    ])
  );
  const match = {
    title_str: "#title 2 races\n",
    format: "5v5",
    races_played: 2,
    league: "ctc",
    season: "s3",
    division: "d2",
    match_number: 1,
    match_label: "Substitution artifact test",
    rxx: ["r12345678"],
    tracks: ["Substitution Test 1", "Substitution Test 2"],
    teams: {
      Alpha: {
        table_tag_str: "Alpha #4F8CFF",
        hex_color: "#4F8CFF",
        penalties: 0,
        players: alphaPlayers,
      },
      Beta: {
        table_tag_str: "Beta #F45D8C",
        hex_color: "#F45D8C",
        penalties: 0,
        players: betaPlayers,
      },
    },
  };

  await page.locator('input[type="file"]').setInputFiles({
    name: "substitution-artifacts.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });

  await expect(page.getByText(/gives Incoming .* disconnection points/)).not.toBeVisible();
  await expect(page.getByText(/gives Outgoing .* disconnection points/)).not.toBeVisible();

  await page.getByText("Generated JSON Preview").click();
  const generated = JSON.parse((await page.locator("details pre").textContent()) ?? "{}");
  expect(generated.teams.Alpha.players["0000-0000-0001"].race_scores).toEqual([15, null]);
  expect(generated.teams.Alpha.players["0000-0000-0002"].race_scores).toEqual([null, 15]);
});

test("json editor detects every positionless DC award in reduced rooms", async ({ page }) => {
  await page.goto("/json-editor?league=ctc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();

  const scoresByRoomSize = {
    8: [15, 11, 8, 6, 4, 2, 1, 0],
    9: [15, 11, 8, 6, 4, 3, 2, 1, 0],
  };
  const players = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => {
      const position = index + 1;
      const positions = [position <= 9 ? position : null, position <= 8 ? position : null];
      const scores = [
        position <= 9 ? scoresByRoomSize[9][index] : 3,
        position <= 8 ? scoresByRoomSize[8][index] : 3,
      ];
      return [
        `0000-0000-${String(position).padStart(4, "0")}`,
        {
          table_str: `Player ${position}`,
          mii_name: `Player ${position}`,
          lounge_name: `Player ${position}`,
          table_name: `Player ${position}`,
          tag: position <= 5 ? "Alpha" : "Beta",
          total_score: scores.reduce((total, score) => total + score, 0),
          had_penalties: false,
          penalties: 0,
          subbed_out: positions[1] === null,
          race_scores: scores,
          race_positions: positions,
        },
      ];
    })
  );
  const match = {
    title_str: "#title 2 races\n",
    format: "5v5",
    races_played: 2,
    league: "ctc",
    season: "s3",
    division: "d2",
    match_number: 1,
    match_label: "Reduced-room DC test",
    rxx: ["r12345678"],
    tracks: ["Reduced Room 1", "Reduced Room 2"],
    teams: {
      Alpha: {
        table_tag_str: "Alpha #4F8CFF",
        hex_color: "#4F8CFF",
        penalties: 0,
        players: Object.fromEntries(Object.entries(players).slice(0, 5)),
      },
      Beta: {
        table_tag_str: "Beta #F45D8C",
        hex_color: "#F45D8C",
        penalties: 0,
        players: Object.fromEntries(Object.entries(players).slice(5)),
      },
    },
  };

  await page.locator('input[type="file"]').setInputFiles({
    name: "reduced-room-disconnections.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });

  await expect(page.getByText("9 / 9 placed; 1 DC award")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("8 / 8 placed; 2 DC award")).toBeVisible();

  await page.getByText("Generated JSON Preview").click();
  const generated = JSON.parse((await page.locator("details pre").textContent()) ?? "{}");
  expect(generated.teams.Beta.players["0000-0000-0009"].race_scores).toEqual([0, 3]);
  expect(generated.teams.Beta.players["0000-0000-0010"].race_scores).toEqual([3, 3]);
  expect(generated.teams.Beta.players["0000-0000-0009"].race_positions).toEqual([9, null]);
  expect(generated.teams.Beta.players["0000-0000-0010"].race_positions).toEqual([null, null]);
});

test("json editor locks a three-team semifinal to Series 1", async ({ page }) => {
  await page.goto("/json-editor?league=ctc");
  await page.getByRole("button", { name: "No Thanks", exact: true }).click();

  const match = {
    title_str: "#title 1 races\n",
    format: "5v5",
    races_played: 1,
    league: "ctc",
    season: "s-test",
    division: "d-test",
    match_type: "playoff",
    playoff_format: "three_team",
    playoff_stage: "semifinals",
    playoff_series_number: 2,
    series_match_number: 1,
    best_of: 3,
    match_label: "Three-team semifinal lock test",
    rxx: ["r12345678"],
    tracks: ["Semifinal Test"],
    teams: {
      Alpha: {
        table_tag_str: "Alpha #4F8CFF",
        hex_color: "#4F8CFF",
        penalties: 0,
        players: {
          "0000-0000-0001": {
            lounge_name: "Alpha player",
            table_name: "Alpha player",
            mii_name: "Alpha player",
            tag: "Alpha",
            penalties: 0,
            race_positions: [1],
            race_scores: [15],
          },
        },
      },
      Beta: {
        table_tag_str: "Beta #F45D8C",
        hex_color: "#F45D8C",
        penalties: 0,
        players: {
          "0000-0000-0002": {
            lounge_name: "Beta player",
            table_name: "Beta player",
            mii_name: "Beta player",
            tag: "Beta",
            penalties: 0,
            race_positions: [2],
            race_scores: [12],
          },
        },
      },
    },
  };

  await page.locator('input[type="file"]').setInputFiles({
    name: "three-team-semifinal.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });

  const seriesNumber = page.getByLabel("Series number, locked");
  await expect(seriesNumber).toBeVisible();
  await expect(seriesNumber).toHaveValue("1");
  await expect(page.locator("#playoff-series-number")).toHaveCount(0);
  await expect(page.getByText("Each playoff team must have a numeric total score.")).toHaveCount(0);

  const teamsSection = page.locator("section").filter({ hasText: "Teams And Players" });
  const alphaTeam = page.locator('[data-team-key="Alpha"]');
  await alphaTeam.getByLabel("Penalty", { exact: true }).fill("3");
  await expect(
    teamsSection.getByText(
      "Playoff teams Alpha and Beta are tied at 12; a playoff match must have a winner."
    )
  ).toBeVisible();
  await alphaTeam.getByLabel("Penalty", { exact: true }).fill("0");

  await page.getByText("Generated JSON Preview").click();
  const generated = JSON.parse((await page.locator("details pre").textContent()) ?? "{}");
  expect(generated.playoff_series_number).toBe(1);
  expect(generated.teams.Alpha.total_score).toBe(15);
  expect(generated.teams.Beta.total_score).toBe(12);
});
