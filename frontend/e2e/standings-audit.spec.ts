import { expect, test } from "@playwright/test";
import type { StandingsAudit } from "../src/features/standings/auditTypes";
import {
  formatQualification,
  type LeaderboardPlayer,
  rankLeaderboard,
} from "../src/features/standings/leaderboard";
import type { AdminSession } from "../src/hooks/useAdminSession";

const query = "league=ctc&season=s3&division=d1";

test("audit follows leaderboard filters, selection, and the source breakdown", async ({
  page,
  request,
}) => {
  const response = await request.get(`/api/standings?${query}`);
  expect(response.ok()).toBeTruthy();
  const data: { leaderboard: LeaderboardPlayer[] } = await response.json();
  const ranked = rankLeaderboard(data.leaderboard, "runner", true);
  expect(ranked.length).toBeGreaterThan(1);
  const first = ranked[0];
  const second = ranked[1];
  await page.goto(`/standings?${query}`);
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page).toHaveURL(/\/standings\/audit\?/);
  await expect(page).toHaveURL(/season=s3/);
  const leaderboard = page.getByRole("region", { name: "Player GP Average" });
  const audit = page.getByRole("region", { name: "Selected player audit" });
  await expect(audit.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  const rows = leaderboard.locator("tbody tr");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await expect(rows.first().locator("td").nth(3)).toHaveText(
    `${first.runner_gps_played}/${first.team_gps}`
  );
  await expect(rows.first().locator("td").nth(4)).toHaveText(
    first.runner_points.toLocaleString("en-US")
  );
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(audit.getByRole("heading", { name: second.name, exact: true })).toBeVisible();
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(
    new RegExp(`player=${second.player_id}&entry=${second.team_season_entry_id}`)
  );
  await expect(audit.getByRole("status")).toContainText("Match totals agree with leaderboard");
  const roleRows = audit.getByRole("region", { name: "Role calculations" }).locator("tbody tr");
  await expect(roleRows).toHaveCount(2);
  await expect(roleRows.first().locator("td").nth(0)).toHaveText(
    second.runner_points.toLocaleString("en-US")
  );
  await expect(roleRows.first().locator("td").nth(1)).toHaveText(String(second.runner_races));
  await expect(roleRows.first().locator("td").nth(2)).toHaveText(String(second.runner_gps_played));
  await expect(roleRows.first().locator("td").nth(3)).toContainText(
    second.runner_gp_average?.toFixed(2) ?? "—"
  );
  await expect(roleRows.first().locator("td").nth(4)).toHaveText("Eligible");
  await expect(
    audit.getByRole("region", { name: "Participation and qualification" })
  ).toContainText(
    `Qualification per role: ${formatQualification(second.team_gps)} GPs / ${formatQualification(second.team_gps, "races")} races`
  );
  const rules = audit.getByText(/^Required GPs =/);
  await expect(rules).toBeHidden();
  await audit.getByText("Calculation rules", { exact: true }).click();
  await expect(rules).toBeVisible();
  await audit.getByText("Calculation rules", { exact: true }).click();
  await expect(audit.getByRole("link", { name: "Open in JSON editor ↗" })).toHaveCount(0);
  await expect(audit.getByRole("link", { name: "View full match ↗" })).toHaveAttribute(
    "href",
    /match=\d+/
  );
  const raceRows = audit.locator('tr[id^="audit-race-"]');
  expect(await raceRows.count()).toBeGreaterThan(0);
  await expect(raceRows.first()).toBeVisible();
  await page.getByRole("button", { name: "All players", exact: true }).click();
  await page.getByRole("button", { name: "Bagging points", exact: true }).click();
  await expect(
    leaderboard.getByText(`${data.leaderboard.length} players`, { exact: true })
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Find player or team" }).fill(first.name);
  await expect(rows.first()).toContainText(first.name);
  await page.getByRole("searchbox").fill("no-player-has-this-name-000");
  await expect(page.getByText("No players match this search.")).toBeVisible();
  await expect(audit.getByRole("heading", { level: 2 })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ).toBeLessThanOrEqual(1);
});

test("only verified administrators and owners see audit editor links", async ({ page }) => {
  let session: AdminSession = { authenticated: false };
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: session }));
  const cases: AdminSession[] = [
    { authenticated: false },
    { authenticated: true },
    {
      authenticated: true,
      admin: { admin_user_id: 1, email: "admin@example.test", role: "admin" },
    },
    {
      authenticated: true,
      admin: { admin_user_id: 2, email: "owner@example.test", role: "owner" },
    },
  ];
  for (const entry of cases) {
    session = entry;
    await page.goto(`/standings/audit?${query}`);
    const audit = page.getByRole("region", { name: "Selected player audit" });
    await expect(audit.getByRole("link", { name: "View full match ↗" })).toBeVisible();
    const editor = audit.getByRole("link", { name: "Open in JSON editor ↗" });
    if (entry.admin) {
      await expect(editor).toBeVisible();
      await expect(editor).toHaveAttribute("href", /edit_match=\d+/);
    } else {
      await expect(editor).toHaveCount(0);
    }
  }
});

test("a review flag opens and focuses its exact race without changing data", async ({
  page,
  request,
}) => {
  const response = await request.get(`/api/standings?${query}`);
  const data: { leaderboard: LeaderboardPlayer[] } = await response.json();
  const player = rankLeaderboard(data.leaderboard, "runner", true)[0];
  const auditResponse = await request.get(
    `/api/standings/audit?${query}&player_id=${player.player_id}&team_season_entry_id=${player.team_season_entry_id}`
  );
  expect(auditResponse.ok()).toBeTruthy();
  const fixture: StandingsAudit = await auditResponse.json();
  expect(fixture.matches.length).toBeGreaterThan(1);
  const match = fixture.matches.find((item, index) => index > 0 && item.races.length > 0);
  if (!match) throw new Error("This audit fixture requires a recorded race.");
  const race = match.races.find((item) => item.gp_number > 1);
  if (!race) throw new Error("This audit fixture requires a race after GP 1.");
  // A deterministic prompt exercises navigation; backend integration tests cover
  // flag detection and its team/season/division boundaries.
  for (const item of fixture.matches) for (const row of item.races) row.flags = [];
  race.flags = ["small_room", "unusual_role"];
  race.role = "bagger";
  fixture.flagged_races = 1;
  await page.route("**/api/standings/audit?**", (route) => route.fulfill({ json: fixture }));
  const mutations: string[] = [];
  page.on("request", (req) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(req.method()) &&
      new URL(req.url()).pathname.startsWith("/api/")
    )
      mutations.push(req.url());
  });
  await page.goto(`/standings/audit?${query}`);
  const breakdown = page.getByRole("region", { name: "Match breakdown" });
  const selector = breakdown.getByRole("combobox", { name: "Match", exact: true });
  const previous = breakdown.getByRole("button", { name: "Previous match" });
  const next = breakdown.getByRole("button", { name: "Next match" });
  await expect(selector).toHaveValue(String(fixture.matches[0].match_id));
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(selector).toHaveValue(String(fixture.matches[1].match_id));
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(selector).toHaveValue(String(fixture.matches[0].match_id));
  await selector.selectOption(String(fixture.matches[fixture.matches.length - 1].match_id));
  await expect(next).toBeDisabled();
  await selector.selectOption(String(fixture.matches[0].match_id));
  await expect(breakdown.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: /Inspect ↓/ }).click();
  await expect(selector).toHaveValue(String(match.match_id));
  const exactRace = page.locator(`#audit-race-${race.race_id}`);
  await expect(exactRace).toBeVisible();
  await expect(exactRace).toBeFocused();
  await expect(exactRace).toContainText(race.track);
  await expect(exactRace).toContainText("Unusual role");
  const gpTab = (gp: number) => breakdown.getByRole("tab", { name: `GP ${gp}`, exact: true });
  await expect(gpTab(race.gp_number)).toHaveAttribute("aria-selected", "true");
  await expect(exactRace.getByText("bagger", { exact: true })).toHaveCSS(
    "background-color",
    "rgb(245, 158, 11)"
  );
  await expect(exactRace.getByText("bagger", { exact: true })).toHaveCSS("color", "rgb(0, 0, 0)");
  const gpNumbers = [...new Set(match.races.map((item) => item.gp_number))].toSorted(
    (left, right) => left - right
  );
  await gpTab(gpNumbers[0]).click();
  await expect(exactRace).toHaveCount(0);
  await expect(breakdown.getByRole("columnheader", { name: "Review", exact: true })).toHaveCount(0);
  const visibleRaces = breakdown.locator('tr[id^="audit-race-"]');
  await expect(visibleRaces).toHaveCount(
    match.races.filter((item) => item.gp_number === gpNumbers[0]).length
  );
  await gpTab(gpNumbers[0]).focus();
  await page.keyboard.press("ArrowRight");
  await expect(gpTab(gpNumbers[1])).toHaveAttribute("aria-selected", "true");
  await expect(gpTab(gpNumbers[1])).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(gpTab(gpNumbers[0])).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(gpTab(gpNumbers[gpNumbers.length - 1])).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Inspect ↓/ }).click();
  await expect(gpTab(race.gp_number)).toHaveAttribute("aria-selected", "true");
  await expect(exactRace).toBeFocused();
  await selector.selectOption(String(fixture.matches[0].match_id));
  await expect(exactRace).toHaveCount(0);
  await page.getByRole("button", { name: /Inspect ↓/ }).click();
  await expect(selector).toHaveValue(String(match.match_id));
  await expect(gpTab(race.gp_number)).toHaveAttribute("aria-selected", "true");
  await expect(exactRace).toBeVisible();
  await expect(exactRace).toBeFocused();
  await page.getByRole("button", { name: "Expand review", exact: true }).click();
  await expect(page.getByRole("button", { name: /All flags · 1/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(mutations).toEqual([]);
  await page.getByRole("button", { name: "Collapse review", exact: true }).click();
  await expect(page.getByRole("button", { name: /All flags · 1/ })).toBeHidden();
});

test("aggregate GP records page independently and whole-match totals stay intact", async ({
  page,
  request,
}) => {
  const response = await request.get(`/api/standings?${query}`);
  const data: { leaderboard: LeaderboardPlayer[] } = await response.json();
  const player = rankLeaderboard(data.leaderboard, "runner", true)[0];
  const auditResponse = await request.get(
    `/api/standings/audit?${query}&player_id=${player.player_id}&team_season_entry_id=${player.team_season_entry_id}`
  );
  const fixture: StandingsAudit = await auditResponse.json();
  const gpMatch = fixture.matches[0];
  const wholeMatch = fixture.matches[1];
  gpMatch.source = "unaccounted";
  gpMatch.races = [];
  gpMatch.aggregate_entries = [
    { gp_number: 1, role: "runner", races: 4, points: 32, disconnection_points: 0 },
    { gp_number: 2, role: "bagger", races: 4, points: 4, disconnection_points: 0 },
    { gp_number: 3, role: "runner", races: 1, points: 4, disconnection_points: 0 },
  ];
  gpMatch.roles = { runner: { races: 5, points: 36 }, bagger: { races: 4, points: 4 } };
  wholeMatch.source = "unaccounted";
  wholeMatch.races = [];
  wholeMatch.aggregate_entries = [
    { gp_number: null, role: "runner", races: 12, points: 96, disconnection_points: 0 },
  ];
  wholeMatch.roles = { runner: { races: 12, points: 96 }, bagger: { races: 0, points: 0 } };
  fixture.matches = [gpMatch, wholeMatch];
  fixture.flagged_races = 0;
  await page.route("**/api/standings/audit?**", (route) => route.fulfill({ json: fixture }));
  await page.goto(`/standings/audit?${query}`);
  const breakdown = page.getByRole("region", { name: "Match breakdown" });
  await expect(page.getByText("No races flagged by these checks.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^All flags/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand review", exact: true })).toHaveCount(0);
  const gp = (number: number) => breakdown.getByRole("tab", { name: `GP ${number}`, exact: true });
  const rows = breakdown.locator("tbody tr");
  await expect(gp(1)).toHaveAttribute("aria-selected", "true");
  const gpTotals = breakdown.getByRole("region", { name: "Selected GP totals" });
  await expect(gpTotals).toContainText("GP 1:");
  await expect(gpTotals.locator("strong")).toHaveText("32 pts");
  await expect(gpTotals).toContainText("32 pts · 4 races");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("GP 1");
  await expect(rows.first().getByText("runner", { exact: true })).toHaveCSS(
    "background-color",
    "rgb(59, 130, 246)"
  );
  await gp(2).click();
  await expect(rows.first()).toContainText("GP 2");
  await expect(gpTotals.locator("strong")).toHaveText("4 pts");
  await expect(rows.first()).toContainText("bagger");
  await gp(3).click();
  await expect(rows.first()).toContainText("GP 3");
  await expect(gpTotals).toContainText("4 pts · 1 race");
  await expect(rows.first().locator("td").nth(2)).toHaveText("1");
  await expect(gp(3)).toHaveAttribute("aria-selected", "true");
  await breakdown
    .getByRole("combobox", { name: "Match", exact: true })
    .selectOption(String(wholeMatch.match_id));
  await expect(breakdown.getByRole("tablist", { name: "Grand Prix" })).toHaveCount(0);
  await expect(gpTotals).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Whole match");
  await expect(rows.first().locator("td").nth(3)).toHaveText("96");
});

test("leaderboard pages track the audit height without vertical scrolling", async ({
  page,
  request,
}) => {
  const response = await request.get(`/api/standings?${query}`);
  const data: { leaderboard: LeaderboardPlayer[] } = await response.json();
  const original = rankLeaderboard(data.leaderboard, "runner", true)[0];
  const auditResponse = await request.get(
    `/api/standings/audit?${query}&player_id=${original.player_id}&team_season_entry_id=${original.team_season_entry_id}`
  );
  const fixture: StandingsAudit = await auditResponse.json();
  const players = Array.from(
    { length: 60 },
    (_, index): LeaderboardPlayer => ({
      ...original,
      player_id: 100000 + index,
      name: `Audit Player ${String(index + 1).padStart(2, "0")}`,
    })
  );
  let flags = 0;
  for (const match of fixture.matches)
    for (const race of match.races) {
      race.flags = flags < 8 ? ["small_room"] : [];
      flags += race.flags.length;
    }
  fixture.flagged_races = flags;
  await page.route("**/api/standings?**", (route) =>
    route.fulfill({ json: { leaderboard: players } })
  );
  await page.route("**/api/standings/audit?**", (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get("player_id"));
    return route.fulfill({
      json: { ...fixture, player: players.find((player) => player.player_id === id) ?? players[0] },
    });
  });
  await page.goto(`/standings/audit?${query}`);
  const left = page.getByRole("region", { name: "Player GP Average" });
  const right = page.getByRole("region", { name: "Selected player audit" });
  await expect(right.getByRole("heading", { name: players[0].name, exact: true })).toBeVisible();
  const rows = left.locator("tbody tr");
  const viewport = left.locator("table").locator("..");
  async function expectFittedCards() {
    await expect
      .poll(async () => {
        const [a, b] = await Promise.all([left.boundingBox(), right.boundingBox()]);
        return Math.abs((a?.height ?? 0) - (b?.height ?? 1));
      })
      .toBeLessThan(0.1);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeLessThanOrEqual(1);
    await expect(viewport).toHaveCSS("overflow-y", "hidden");
  }
  await expectFittedCards();
  const initialHeight = (await right.boundingBox())?.height ?? 0;
  const initialRows = await rows.count();
  expect(initialRows).toBeGreaterThan(0);
  expect(initialRows).toBeLessThan(players.length);
  await right.getByText("Calculation rules", { exact: true }).click();
  await expect
    .poll(async () => (await right.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initialHeight);
  await expect.poll(() => rows.count()).toBeGreaterThan(initialRows);
  await expectFittedCards();
  await right.getByText("Calculation rules", { exact: true }).click();
  await expect.poll(() => rows.count()).toBe(initialRows);
  await expectFittedCards();
  await right.getByRole("button", { name: "Expand review", exact: true }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(initialRows);
  await expectFittedCards();
  await right.getByRole("button", { name: "Collapse review", exact: true }).click();
  await expect.poll(() => rows.count()).toBe(initialRows);
  const firstName = await rows.first().locator("td").nth(1).innerText();
  await left.getByRole("button", { name: "Next players" }).click();
  await expect(rows.first().locator("td").nth(1)).not.toHaveText(firstName);
  await expect(right.getByRole("heading", { name: players[0].name, exact: true })).toBeVisible();
  await expectFittedCards();
  const nextName = await rows.first().locator("td").nth(1).innerText();
  await rows.first().click();
  await expect(right.getByRole("heading", { name: nextName, exact: true })).toBeVisible();
  await expect(left.locator('tr[aria-selected="true"]')).toHaveCount(1);
  await expectFittedCards();
  await page.getByRole("searchbox", { name: "Find player or team" }).fill("Audit Player 59");
  await expect(rows).toHaveCount(1);
  await expect(left.getByRole("button", { name: "Previous players" })).toBeDisabled();
  await expect(left.getByRole("button", { name: "Next players" })).toBeDisabled();
  await expectFittedCards();
});

// Repeating eligibility thresholds must stay exact, including thresholds below one GP.
test("qualification displays exact fractions without rounding GP requirements", () => {
  for (const [teamGps, gps, races] of [
    [0.25, "⅙", "⅔"],
    [1.75, "1⅙", "4⅔"],
    [2.5, "1⅔", "6⅔"],
    [3, "2", "8"],
    [3.25, "2⅙", "8⅔"],
  ] as const) {
    expect(formatQualification(teamGps)).toBe(gps);
    expect(formatQualification(teamGps, "races")).toBe(races);
  }
});
