import { expect, type Page, test } from "@playwright/test";

const codes = Array.from(
  { length: 10 },
  (_, index) => `1000-2000-${String(index).padStart(4, "0")}`
);
const tracks = Array.from({ length: 12 }, (_, index) => `Track ${index + 1}`);
const match = {
  league: "gsc",
  season: "s16",
  division: "d10",
  match_number: 4,
  format: "5v5",
  races_played: 12,
  tracks,
  teams: Object.fromEntries(
    ["A", "B"].map((tag, teamIndex) => [
      tag,
      {
        table_tag_str: tag,
        players: Object.fromEntries(
          codes.slice(teamIndex * 5, teamIndex * 5 + 5).map((code, index) => [
            code,
            {
              mii_name: code,
              race_positions: Array(12).fill(teamIndex * 5 + index + 1),
              race_scores: Array(12).fill([15, 12, 10, 8, 6, 4, 3, 2, 1, 0][teamIndex * 5 + index]),
            },
          ])
        ),
      },
    ])
  ),
};

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function upload(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "match.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(match)),
  });
}

async function prepare(
  page: Page,
  options: {
    catalog?: Promise<void>;
    batch?: (index: number) => Promise<void>;
    unknown?: string[];
    enrichment?: Promise<void>;
    staleFirstBatch?: boolean;
  } = {}
) {
  const counts = { batches: 0, trackFallbacks: 0, enrichments: 0 };
  const memberships: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json: unknown = [];
    switch (url.pathname) {
      case "/api/auth/session":
        json = { authenticated: false };
        break;
      case "/api/match-scopes":
        json = [{ league: "gsc", season: "s16", division: "d10" }];
        break;
      case "/api/team-scopes":
        json = ["A", "B"].map((tag, index) => ({
          league: "gsc",
          season: "s16",
          division: "d10",
          team_id: index + 1,
          team_season_entry_id: index + 1,
          canonical_tag: tag,
          canonical_name: tag,
          clan_tag: tag,
          display_name: tag,
        }));
        break;
      case "/api/playoff-series":
        json = { series: [], format: null };
        break;
      case "/api/track-search":
        if (url.searchParams.get("query")) counts.trackFallbacks++;
        else await options.catalog;
        json = tracks.map((name, index) => ({
          track_id: index + 1,
          name,
          league: "gsc",
          aliases: [],
        }));
        break;
      case "/api/player-identities/batch": {
        const index = ++counts.batches;
        await options.batch?.(index);
        json = Object.fromEntries(
          (url.searchParams.get("friend_codes") ?? "").split(",").map((code) => [
            code,
            {
              reason: "exact_friend_code",
              results: options.unknown?.includes(code)
                ? []
                : [
                    {
                      player_id:
                        Number(code.slice(-4)) +
                        1 +
                        (options.staleFirstBatch && index === 1 ? 100 : 0),
                      canonical_name: `Player ${code}`,
                      primary_friend_code: code,
                      friend_codes: [code],
                      aliases: [],
                    },
                  ],
            },
          ])
        );
        break;
      }
      case "/api/player-identities":
        counts.enrichments++;
        await options.enrichment;
        json = { reason: "none", results: [], mkc_lookup: { status: "not_found" } };
        break;
      case "/api/player-team-memberships":
        memberships.push(url.searchParams.get("player_ids") ?? "");
        break;
    }
    await route.fulfill({ json });
  });
  await page.goto("/json-editor?league=gsc");
  return { counts, memberships };
}

test("one identity batch and one complete membership check; wait for the track catalog", async ({
  page,
}) => {
  const catalog = deferred();
  const batch = deferred();
  const { counts, memberships } = await prepare(page, {
    catalog: catalog.promise,
    batch: () => batch.promise,
  });
  await upload(page);
  await expect.poll(() => counts.batches).toBe(1);
  expect(memberships).toEqual([]);
  expect(counts.trackFallbacks).toBe(0);
  batch.resolve();
  await expect.poll(() => memberships.length).toBe(1);
  expect(memberships[0]).toBe("1,2,3,4,5,6,7,8,9,10");
  catalog.resolve();
  await expect(page.getByText("Confirmed as a GSC track", { exact: true }).first()).toBeVisible();
  expect(counts).toEqual({ batches: 1, trackFallbacks: 0, enrichments: 0 });
});

test("unknown players retain enrichment with bounded concurrency and one final membership check", async ({
  page,
}) => {
  const enrichment = deferred();
  const { counts, memberships } = await prepare(page, {
    unknown: codes.slice(0, 3),
    enrichment: enrichment.promise,
  });
  await upload(page);
  await expect.poll(() => counts.enrichments).toBe(2);
  expect(memberships).toEqual([]);
  enrichment.resolve();
  await expect.poll(() => memberships.length).toBe(1);
  expect(counts.enrichments).toBe(3);
  expect(memberships[0]).toBe("4,5,6,7,8,9,10");
  await expect(
    page.getByText("Not found in the database or MKCentral", { exact: false }).first()
  ).toBeVisible();
});

test("an old identity batch cannot replace the identities of a newly loaded match", async ({
  page,
}) => {
  const oldBatch = deferred();
  const { counts, memberships } = await prepare(page, {
    batch: (index) => (index === 1 ? oldBatch.promise : Promise.resolve()),
    staleFirstBatch: true,
  });
  await upload(page);
  await expect.poll(() => counts.batches).toBe(1);
  await upload(page);
  await expect.poll(() => memberships.length).toBe(1);
  const oldResponse = page.waitForResponse((response) =>
    response.url().includes("/api/player-identities/batch")
  );
  oldBatch.resolve();
  await oldResponse;
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Confirmed as a GSC track", { exact: true }).first()).toBeVisible();
  expect(counts.batches).toBe(2);
  expect(memberships).toEqual(["1,2,3,4,5,6,7,8,9,10"]);
});
