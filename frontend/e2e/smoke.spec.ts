import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/stats",
  "/top-team-players",
  "/top-tracks",
  "/best-matchups",
  "/matches",
  "/players/180",
  "/teams/41",
  "/json-editor",
  "/database-health",
];

for (const route of routes) {
  test(`${route} loads`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok(), `${route} should return a successful document`).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
  });
}

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
    week: 1,
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
  await page.goto("/json-editor");
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

  await expect(page.getByText("League is missing.")).toBeVisible();
  await expect(page.getByText("Season is missing.")).toBeVisible();
  await expect(page.getByText("Division is missing.")).toBeVisible();
  await expect(page.getByText("Match label is missing.")).toBeVisible();
  await expect(
    page.getByText("Week is required and must be a positive whole number.")
  ).toBeVisible();
  await expect(
    page.getByText("This match contains 2 races instead of the usual 12.")
  ).toBeVisible();
  await expect(page.locator('[data-required-marker="true"]')).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Review & Upload" }).first()).toBeDisabled();

  const metadata = page.locator("section").filter({ hasText: "Additional Metadata" });
  await metadata.getByLabel(/league/i).fill("ctc");
  await metadata.getByLabel(/season/i).fill("s3");
  await metadata.getByLabel(/division/i).fill("d2");
  await metadata.getByLabel(/match label/i).fill("Metadata validation test");
  await metadata.getByLabel(/week/i).fill("1");

  await expect(page.getByText("Match label is missing.")).not.toBeVisible();
  await expect(page.locator('[data-required-marker="true"]')).toHaveCount(0);
  await expect(
    page.getByText("This match contains 2 races instead of the usual 12.")
  ).toBeVisible();
});
