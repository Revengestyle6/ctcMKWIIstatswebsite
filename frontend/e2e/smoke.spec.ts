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
