import { expect, type Page, test } from "@playwright/test";

const match = {
  league: "ctc",
  season: "s4",
  division: "d2",
  match_number: 1,
  format: "5v5",
  result_type: "free_win",
  free_win_winner: "A",
  races_played: 0,
  tracks: [],
  rxx: [],
  teams: {
    A: { table_tag_str: "A #4F8CFF", total_score: 150, players: {} },
    B: { table_tag_str: "B #F45D8C", total_score: 0, players: {} },
  },
};
const warnings = [
  "Administrators must review 1 new database entries.",
  "Unaccounted match: race and track data are unavailable; only totals and recorded GPs can contribute to analytics.",
  "This match contains 8 races instead of the usual 12.",
  "One or more teams has penalty points.",
  "24 race roles require inference or administrator review.",
];

for (const authenticated of [false, true]) {
  for (const serverWarning of [false, true]) {
    test(`${authenticated ? "administrator" : "anonymous"} can submit with ${serverWarning ? "additional server" : "zero"} warnings`, async ({
      page,
    }) => {
      const submitted: boolean[] = [];
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/session")
          return route.fulfill({
            json: {
              authenticated,
              admin: authenticated
                ? { admin_user_id: 1, email: "owner@example.com", role: "owner" }
                : undefined,
            },
          });
        if (path === "/api/match-scopes")
          return route.fulfill({ json: [{ league: "ctc", season: "s4", division: "d2" }] });
        if (path === "/api/team-scopes")
          return route.fulfill({
            json: ["A", "B"].map((tag, index) => ({
              league: "ctc",
              season: "s4",
              division: "d2",
              team_id: index + 1,
              team_season_entry_id: index + 1,
              canonical_tag: tag,
              canonical_name: tag,
              clan_tag: tag,
              display_name: tag,
            })),
          });
        if (path === "/api/playoff-series")
          return route.fulfill({
            json: { season: "s4", division: "d2", format: null, series: [] },
          });
        if (path === "/api/matches/new-entries")
          return route.fulfill({ json: { new_entries: [] } });
        if (path === "/api/matches/preview")
          return route.fulfill({
            json: {
              match: {
                ...match,
                match_id: 1,
                label: "M1 A vs B — Free win",
                teams: [],
                differential: [],
                import_status: "imported",
                review_notes: null,
              },
              preview: { fingerprint: "preview", archive_path: "test.json", new_entries: [] },
            },
          });
        if (path.endsWith("/review-submissions")) {
          expect(path).toBe(
            authenticated ? "/api/admin/review-submissions" : "/api/review-submissions"
          );
          const acknowledged = route.request().postDataJSON().warnings_acknowledged === true;
          submitted.push(acknowledged);
          if (serverWarning && !acknowledged)
            return route.fulfill({
              status: 409,
              json: { error: "Warnings must be acknowledged.", warnings },
            });
          return route.fulfill({ status: 202, json: { receipt: "receipt-1", status: "pending" } });
        }
        return route.fulfill({ json: [] });
      });
      page.on("dialog", (dialog) => dialog.accept());
      await page.goto("/json-editor?league=ctc");
      await page.locator('input[type="file"]').setInputFiles({
        name: "match.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(match)),
      });
      await expect(page.getByText("0 errors / 0 warnings", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();
      const submit = page.getByRole("button", {
        name: authenticated ? "Submit to review queue" : "Submit for admin review",
        exact: true,
      });
      await expect(submit).toBeEnabled();
      await expect(
        page.getByRole("checkbox", { name: /acknowledge the validation warnings/ })
      ).toHaveCount(0);
      await submit.click();
      if (serverWarning) {
        for (const warning of warnings)
          await expect(
            page
              .getByRole("region", { name: "Validation", exact: true })
              .getByText(warning, { exact: false })
          ).toBeVisible();
        await expect(submit).toBeDisabled();
        await page.getByRole("checkbox", { name: /acknowledge the validation warnings/ }).check();
        await submit.click();
      }
      await expect(
        page.getByText("Submitted for administrator review.", { exact: true })
      ).toBeVisible();
      expect(submitted).toEqual(serverWarning ? [false, true] : [false]);
    });
  }
}

async function prepareFailureCase(
  page: Page,
  pathToFail: string,
  failAfterCommit = false
): Promise<() => void> {
  let failing = !failAfterCommit;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === pathToFail && failing)
      return route.fulfill({ status: 400, json: { error: `Caught failure at ${path}` } });
    if (path === "/api/auth/session")
      return route.fulfill({
        json: {
          authenticated: true,
          admin: { admin_user_id: 1, email: "owner@example.com", role: "owner" },
        },
      });
    if (path === "/api/match-scopes")
      return route.fulfill({ json: [{ league: "ctc", season: "s4", division: "d2" }] });
    if (path === "/api/team-scopes")
      return route.fulfill({
        json: ["A", "B"].map((tag, index) => ({
          league: "ctc",
          season: "s4",
          division: "d2",
          team_id: index + 1,
          team_season_entry_id: index + 1,
          canonical_tag: tag,
          canonical_name: tag,
          clan_tag: tag,
          display_name: tag,
        })),
      });
    if (path === "/api/playoff-series")
      return route.fulfill({ json: { format: null, series: [] } });
    if (path === "/api/player-identities") return route.fulfill({ json: { results: [] } });
    if (path === "/api/matches/new-entries") return route.fulfill({ json: { new_entries: [] } });
    if (path === "/api/matches/preview")
      return route.fulfill({
        json: {
          match: {
            ...match,
            match_id: 1,
            label: "M1 A vs B — Free win",
            teams: [],
            differential: [],
            review_notes: null,
          },
          preview: { fingerprint: "preview", archive_path: "test.json", new_entries: [] },
        },
      });
    if (path === "/api/admin/review-submissions")
      return route.fulfill({ status: 202, json: { receipt: "receipt-1", status: "pending" } });
    if (path === "/api/matches/commit") {
      if (failAfterCommit) failing = true;
      return route.fulfill({
        json: { status: "committed", match_id: 1, additions: [], archive_status: "complete" },
      });
    }
    return route.fulfill({ json: [] });
  });
  page.on("dialog", (dialog) => dialog.accept());
  return () => {
    failing = false;
  };
}

for (const stage of [
  "new-entries",
  "preview",
  "queue",
  "commit",
  "management",
  "match-scopes",
  "team-scopes",
  "track-search",
  "playoff-series",
  "database-additions",
  "auth/session",
  "player-identities",
  "team-roster-pool",
] as const) {
  test(`${stage} failures appear in Validation`, async ({ page }) => {
    const path =
      stage === "management"
        ? "/api/admin/matches/42/management"
        : stage === "queue"
          ? "/api/admin/review-submissions"
          : ["new-entries", "preview", "commit"].includes(stage)
            ? `/api/matches/${stage}`
            : `/api/${stage}`;
    const recover = await prepareFailureCase(page, path);
    await page.goto(`/json-editor?league=ctc${stage === "management" ? "&edit_match=42" : ""}`);
    if (stage !== "management")
      await page.locator('input[type="file"]').setInputFiles({
        name: "match.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify(
            ["player-identities", "team-roster-pool"].includes(stage)
              ? {
                  ...match,
                  result_type: "played",
                  free_win_winner: undefined,
                  races_played: 1,
                  tracks: ["Wii Luigi Circuit"],
                  teams: {
                    ...match.teams,
                    A: {
                      ...match.teams.A,
                      players: {
                        "1111-1111-1111": {
                          mii_name: "Runner",
                          race_positions: [1],
                          race_scores: [15],
                        },
                      },
                    },
                  },
                }
              : match
          )
        ),
      });
    if (stage === "team-roster-pool")
      await page.getByRole("button", { name: "Team roster pool" }).first().click();
    if (["new-entries", "preview", "queue", "commit"].includes(stage)) {
      await expect(page.getByLabel("Result entry")).toHaveValue("free_win");
      await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();
      if (stage === "queue" || stage === "commit")
        await page
          .getByRole("button", {
            name: stage === "queue" ? "Submit to review queue" : "Confirm upload",
            exact: true,
          })
          .click();
    }
    const validation = page.getByRole("region", { name: "Validation", exact: true });
    await expect(validation.getByText(`Caught failure at ${path}`, { exact: false })).toBeVisible();
    // Transport and server failures must remain retryable after becoming visible.
    if (["new-entries", "preview", "queue", "commit"].includes(stage)) {
      recover();
      if (stage === "queue") {
        await page.getByRole("button", { name: "Submit to review queue", exact: true }).click();
        await expect(
          page.getByText("Submitted for administrator review.", { exact: true })
        ).toBeVisible();
      } else if (stage === "commit") {
        await page.getByRole("button", { name: "Confirm upload", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Uploaded", exact: true }).first()
        ).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();
        await expect(
          page.getByRole("button", { name: "Confirm upload", exact: true })
        ).toBeEnabled();
      }
      await expect(validation.getByText(`Caught failure at ${path}`, { exact: false })).toHaveCount(
        0
      );
    }
  });
}

test("JSON parsing errors appear in Validation", async ({ page }) => {
  await prepareFailureCase(page, "/unused");
  await page.goto("/json-editor?league=ctc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("[]"),
  });
  await expect(
    page
      .getByRole("region", { name: "Validation", exact: true })
      .getByText("Match JSON must be a single JSON object.", { exact: false })
  ).toBeVisible();
});

test("a damaged saved review draft is reported in Validation", async ({ page }) => {
  await prepareFailureCase(page, "/unused");
  await page.addInitScript(() => sessionStorage.setItem("ctc-review-draft", "invalid-json"));
  await page.goto("/json-editor?league=ctc");
  await expect(
    page
      .getByRole("region", { name: "Validation", exact: true })
      .getByText("The saved review draft could not be restored", { exact: false })
  ).toBeVisible();
});

for (const catalog of ["match-scopes", "team-scopes", "track-search"] as const) {
  test(`post-save ${catalog} refresh errors appear without hiding a successful save`, async ({
    page,
  }) => {
    const path = `/api/${catalog}`;
    await prepareFailureCase(page, path, true);
    await page.goto("/json-editor?league=ctc");
    await page.locator('input[type="file"]').setInputFiles({
      name: "match.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(match)),
    });
    await expect(page.getByLabel("Result entry")).toHaveValue("free_win");
    await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();
    await page.getByRole("button", { name: "Confirm upload", exact: true }).click();
    await expect(page.getByRole("button", { name: "Uploaded", exact: true }).first()).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Validation", exact: true })
        .getByText(`Caught failure at ${path}`, { exact: false })
    ).toBeVisible();
  });
}

test("server preview review notes appear in Validation", async ({ page }) => {
  await prepareFailureCase(page, "/unused");
  const warning = "Server detected a match fact requiring administrator review.";
  await page.route("**/api/matches/preview", (route) =>
    route.fulfill({
      json: {
        match: {
          ...match,
          match_id: 1,
          label: "M1 A vs B — Free win",
          teams: [],
          differential: [],
          import_status: "imported",
          review_notes: warning,
        },
        preview: { fingerprint: "preview", archive_path: "test.json", new_entries: [] },
      },
    })
  );
  await page.goto("/json-editor?league=ctc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "match.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });
  await expect(page.getByLabel("Result entry")).toHaveValue("free_win");
  await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();
  await expect(
    page
      .getByRole("region", { name: "Validation", exact: true })
      .getByText(warning, { exact: false })
  ).toBeVisible();
});

test("a committed match with an archive repair warning reports it in Validation", async ({
  page,
}) => {
  await prepareFailureCase(page, "/unused");
  const warning = "Match committed; archive reconciliation is required.";
  await page.route("**/api/matches/commit", (route) =>
    route.fulfill({
      status: 202,
      json: {
        status: "committed",
        match_id: 1,
        additions: [],
        archive_status: "repair_required",
        message: warning,
      },
    })
  );
  await page.goto("/json-editor?league=ctc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "match.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });
  await expect(page.getByLabel("Result entry")).toHaveValue("free_win");
  await page.getByRole("button", { name: "Review & Upload", exact: true }).first().click();
  await page.getByRole("button", { name: "Confirm upload", exact: true }).click();
  await expect(page.getByRole("button", { name: "Uploaded", exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Validation", exact: true })
      .getByText(warning, { exact: false })
  ).toBeVisible();
});
