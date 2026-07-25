import path from "node:path";
import { expect, test } from "@playwright/test";

const routes = [
  { name: "home", path: "/" },
  { name: "player-statistics", path: "/stats" },
  { name: "team-statistics", path: "/top-team-players" },
  { name: "track-averages", path: "/top-tracks" },
  { name: "team-matchups", path: "/best-matchups" },
  { name: "match-history", path: "/matches" },
  { name: "player-dashboard", path: "/players/180" },
  { name: "team-dashboard", path: "/teams/41" },
  { name: "json-editor", path: "/json-editor" },
  { name: "database-health", path: "/database-health" },
];

const outputDirectory = path.resolve(process.cwd(), "../docs/baselines/phase-0-2026-07-19/ui");

test("capture representative application routes", async ({ page }, testInfo) => {
  for (const route of routes) {
    const response = await page.goto(route.path);
    expect(response?.ok(), `${route.path} should load`).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    const dismissMusic = page.getByRole("button", { name: "No Thanks" });
    if (await dismissMusic.isVisible()) {
      await dismissMusic.click();
    }
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: path.join(outputDirectory, `${route.name}-${testInfo.project.name}.jpg`),
      type: "jpeg",
      quality: 78,
      fullPage: true,
      animations: "disabled",
    });
  }
});
