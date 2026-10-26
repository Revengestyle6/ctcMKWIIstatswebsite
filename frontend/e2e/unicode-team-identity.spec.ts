import { expect, test } from "@playwright/test";
import { identityTextKey } from "../src/identityText";

for (const [input, expected] of [
  ["ZΣ", "zσ"],
  ["Zσ", "zσ"],
  ["Zς", "zς"],
  ["βς", "βς"],
  ["ΟΣ", "οσ"],
  ["İ", "i"],
  ["ẞ", "ß"],
  ["𐐀", "𐐨"],
]) {
  test(`identity comparison keeps database lowercase semantics for ${input}`, () => {
    expect(identityTextKey(input)).toBe(expected);
  });
}

for (const [firstInput, firstRegistered, second] of [
  ["ZΣ", "ZΣ", "OT"],
  ["zσ", "ZΣ", "OT"],
  ["ZΣ", "ZΣ", "Zς"],
  ["βς", "βς", "OT"],
]) {
  test(`editor recognizes ${firstInput} against ${second} without false team warnings`, async ({
    page,
  }) => {
    const match = {
      league: "gsc",
      season: "s16",
      division: "d2",
      match_number: 1,
      format: "5v5",
      result_type: "mutual_tie",
      races_played: 0,
      tracks: [],
      teams: Object.fromEntries(
        [firstInput, second].map((tag) => [
          tag,
          { table_tag_str: tag, total_score: 0, players: {} },
        ])
      ),
    };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({ json: { authenticated: false } });
      if (path === "/api/match-scopes")
        return route.fulfill({ json: [{ league: "gsc", season: "s16", division: "d2" }] });
      if (path === "/api/team-scopes")
        return route.fulfill({
          json: [firstRegistered, second].map((tag, index) => ({
            league: "gsc",
            season: "s16",
            division: "d2",
            team_id: index + 1,
            team_season_entry_id: index + 1,
            canonical_tag: tag,
            canonical_name: tag,
            clan_tag: tag,
            display_name: tag,
          })),
        });
      if (path === "/api/playoff-series") return route.fulfill({ json: { series: [] } });
      if (path === "/api/matches/new-entries") return route.fulfill({ json: { new_entries: [] } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/json-editor?league=gsc");
    await page.locator('input[type="file"]').setInputFiles({
      name: "unicode-match.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(match)),
    });
    await expect(page.getByText("0 errors / 0 warnings", { exact: true })).toBeVisible();
    const validation = page.getByRole("region", { name: "Validation", exact: true });
    await expect(
      validation.getByText(/does not belong|configured more than once|cannot play itself/)
    ).toHaveCount(0);
  });
}
