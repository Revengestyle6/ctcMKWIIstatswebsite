import { expect, type Page, test } from "@playwright/test";
import type { RaceDraft } from "../src/features/match-editor/matchJsonEditorModel";
import {
  planResultsImport,
  type RecognizedResultRow,
  reviewResultsRows,
} from "../src/features/match-editor/raceResultsImport";

const names = ["Alice", "Benny", "Clark", "Diana", "Ethan", "Frank", "Grace", "Henry★"];
const codes = names.map((_, index) => `1000-2000-${String(index + 1).padStart(4, "0")}`);

async function drawResults(page: Page, compact: boolean) {
  return page.evaluate(
    ({ compact, names }) => {
      const canvas = document.createElement("canvas");
      canvas.width = compact ? 620 : 1400;
      canvas.height = compact ? 420 : 870;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      background.addColorStop(0, "#244a34");
      background.addColorStop(0.5, "#593220");
      background.addColorStop(1, "#201a33");
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const width = 900;
      const height = 52;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(compact ? (5 * Math.PI) / 180 : 0);
      context.scale(compact ? 0.55 : 1.15, compact ? 0.55 : 1.15);
      context.translate(-width / 2, (-height * names.length) / 2);
      context.textBaseline = "middle";
      context.font = "bold 34px Arial";
      for (const [index, name] of names.entries()) {
        const y = index * height;
        context.fillStyle = index === (compact ? 3 : 0) ? "#f7a62a" : "#555c61";
        context.fillRect(0, y, width, height);
        context.fillStyle = "#d0d8d9";
        context.fillRect(0, y + height - 2, width, 2);
        context.fillStyle = "#924a43";
        context.beginPath();
        context.arc(238, y + 26, 12, 0, 2 * Math.PI);
        context.fill();
        const rank = index + (compact ? 3 : 1);
        const suffix = ["st", "nd", "rd"][rank - 1] ?? "th";
        context.lineWidth = 5;
        if (!compact || rank !== 6) {
          context.strokeStyle = "#222";
          context.strokeText(`${rank}${suffix}`, 92, y + 27);
          context.fillStyle = "white";
          context.fillText(`${rank}${suffix}`, 92, y + 27);
        }
        context.strokeStyle = "white";
        context.strokeText(name, 318, y + 27);
        context.fillStyle = "#161616";
        context.fillText(name, 318, y + 27);
        context.fillStyle = "#dde7ff";
        context.fillText("+10", 625, y + 27);
        context.fillText("44 pts", 754, y + 27);
      }
      if (!compact) return canvas.toDataURL("image/png").split(",")[1];
      const crop = document.createElement("canvas");
      crop.width = 470;
      crop.height = canvas.height;
      crop.getContext("2d")?.drawImage(canvas, 0, 0);
      return crop.toDataURL("image/png").split(",")[1];
    },
    { compact, names }
  );
}

async function copyResultsImage(page: Page, base64: string) {
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (byte) => byte.charCodeAt(0));
    const image = new Blob([bytes], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
  }, base64);
}

test("extracts selected, pasted, and dropped images directly into the selected race", async ({
  page,
  context,
}) => {
  let extractionRequests = 0;
  let availabilityStatus = 503;
  let releaseFirstExtraction: () => void = () => {};
  const firstExtraction = new Promise<void>((resolve) => {
    releaseFirstExtraction = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/session") {
      return route.fulfill({ json: { authenticated: true, admin: { role: "admin" } } });
    }
    if (path === "/api/admin/race-results-image") {
      if (request.method() === "GET") {
        return route.fulfill({
          status: availabilityStatus,
          json: { enabled: availabilityStatus === 200 },
        });
      }
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      expect(body).toContain(JSON.stringify(names));
      expect(body).not.toContain(codes[0]);
      const cropped = ++extractionRequests === 2;
      if (extractionRequests === 1) await firstExtraction;
      return route.fulfill({
        json: {
          rows: names.map((name, index) => ({
            position: cropped ? (index === 3 ? null : index + 3) : index + 1,
            name: index === 1 ? "Bny" : name.replace("★", "☆"),
            suggestions: index === 1 ? [1] : [],
          })),
        },
      });
    }
    if (path === "/api/player-identities/batch") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  await page.goto("/json-editor?league=gsc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "match.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        league: "gsc",
        format: "5v5",
        races_played: 2,
        tracks: ["First Track", "Second Track"],
        teams: {
          A: {
            players: Object.fromEntries(
              names.map((mii_name, index) => [codes[index], { mii_name }])
            ),
          },
        },
      })
    ),
  });
  await page.getByLabel("Race selection").selectOption("1");

  const open = page.getByRole("button", { name: "Extract from Image" });
  const raceCard = page.locator("article").filter({ has: page.getByLabel("Race 2 track") });
  const uploader = raceCard.getByRole("region", { name: "Image extraction for Race 2" });
  const hide = raceCard.getByRole("button", { name: "Hide image uploader" });
  const run = uploader.getByRole("button", { name: "Run Extraction" });
  const playerAt = (position: number) =>
    page.getByRole("combobox", { name: `Player in position ${position}`, exact: true });
  const clear = page.getByRole("button", { name: "Clear all positions" });

  await expect(uploader).toBeVisible();
  await expect(uploader.getByRole("alert")).toContainText("Could not check image extraction");
  await hide.click();
  await expect(uploader).toHaveCount(0);
  availabilityStatus = 401;
  await open.click();
  await expect(uploader.getByRole("link", { name: "Administrator sign-in" })).toBeVisible();
  await expect(run).toHaveCount(0);
  await hide.click();

  const original = await drawResults(page, false);
  availabilityStatus = 200;
  await open.click();
  await expect(run).toBeDisabled();
  await uploader.getByLabel("Choose results image").setInputFiles({
    name: "race.png",
    mimeType: "image/png",
    buffer: Buffer.from(original, "base64"),
  });
  await expect(run).toBeEnabled();
  expect(extractionRequests).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await run.click();
  const running = uploader.getByRole("button", { name: "Extracting results…" });
  await expect(running).toBeDisabled();
  await expect(running).toHaveCSS("opacity", "0.4");
  releaseFirstExtraction();
  await expect(uploader).toHaveCount(0);
  await expect(page.getByText("Added 8 placements from the image.")).toBeVisible();
  await expect(playerAt(1)).toHaveValue(`A::${codes[0]}`);
  await expect(playerAt(2)).toHaveValue(`A::${codes[1]}`);
  await expect(playerAt(8)).toHaveValue(`A::${codes[7]}`);
  await clear.click();

  await playerAt(1).selectOption(`A::${codes[0]}`);
  await open.click();
  await expect(run).toBeDisabled();
  const cropped = await drawResults(page, true);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyResultsImage(page, cropped);
  await uploader.getByRole("button", { name: "Paste image" }).click();
  await expect(run).toBeEnabled();
  expect(extractionRequests).toBe(1);
  await run.click();
  await expect(uploader).toHaveCount(0);
  await expect(playerAt(1)).toHaveValue(`A::${codes[0]}`);
  await expect(playerAt(3)).toHaveValue("");
  await expect(playerAt(4)).toHaveValue(`A::${codes[1]}`);
  await expect(playerAt(6)).toHaveValue("");
  await expect(playerAt(7)).toHaveValue(`A::${codes[4]}`);
  await clear.click();
  await expect(uploader).toBeVisible();
  await expect(run).toBeDisabled();
  const dropTarget = uploader.getByText("The image and roster Mii names", { exact: false });
  const browserImage = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", `<img src="data:image/png;base64,${data}">`);
    return transfer;
  }, original);
  await dropTarget.dispatchEvent("drop", { dataTransfer: browserImage });
  await browserImage.dispose();
  await expect(uploader.getByText("Dropped image", { exact: true })).toBeVisible();
  await expect(run).toBeEnabled();
  const imageDrop = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(atob(data), (byte) => byte.charCodeAt(0))], "dropped.png", {
        type: "image/png",
      })
    );
    return transfer;
  }, original);
  const acceptsDrop = await dropTarget.evaluate(
    (target, dataTransfer) =>
      !target.dispatchEvent(
        new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true })
      ),
    imageDrop
  );
  expect(acceptsDrop).toBe(true);
  await expect(uploader.getByRole("region", { name: "Results image", exact: true })).toHaveClass(
    /border-blue-400/
  );
  await dropTarget.dispatchEvent("drop", { dataTransfer: imageDrop });
  await imageDrop.dispose();
  await expect(uploader.getByText("dropped.png")).toBeVisible();
  await run.click();
  await expect(uploader).toHaveCount(0);
  await expect(playerAt(2)).toHaveValue(`A::${codes[1]}`);
  expect(extractionRequests).toBe(3);

  await page.getByLabel("Race selection").selectOption("0");
  await expect(page.getByText("0 / 10 placed")).toBeVisible();
  const firstUploader = page.getByRole("region", { name: "Image extraction for Race 1" });
  await expect(firstUploader).toBeVisible();
  await page.getByRole("button", { name: "All Races", exact: true }).click();
  await expect(firstUploader).toBeVisible();
  await expect(uploader).toHaveCount(0);
  await raceCard.getByRole("button", { name: "Extract from Image", exact: true }).click();
  await expect(firstUploader).toHaveCount(0);
  await expect(uploader).toBeVisible();
});

test("bulk extraction starts together and retries failures only after the first wave settles", async ({
  page,
  context,
}) => {
  let requests = 0;
  const attemptsByRoomSize = new Map<number, number[]>();
  let releaseLastImage: () => void = () => {};
  const lastImage = new Promise<void>((resolve) => {
    releaseLastImage = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/session") {
      return route.fulfill({ json: { authenticated: true, admin: { role: "admin" } } });
    }
    if (path === "/api/admin/race-results-image") {
      if (request.method() === "GET") return route.fulfill({ json: { enabled: true } });
      requests++;
      const roomSize = Number(request.postData()?.match(/name="roomSize"\r\n\r\n(\d+)/)?.[1]);
      expect([10, 11, 12]).toContain(roomSize);
      const attempts = attemptsByRoomSize.get(roomSize) ?? [];
      attempts.push(performance.now());
      attemptsByRoomSize.set(roomSize, attempts);
      if (roomSize === 10 && attempts.length === 1) {
        return route.fulfill({
          status: 429,
          json: { error: "Request limit", retry_after_seconds: 1 },
        });
      }
      if (roomSize === 11 && attempts.length <= 2) {
        return route.fulfill({ status: 502, json: { error: "Could not read the image." } });
      }
      if (roomSize === 12) await lastImage;
      return route.fulfill({
        json: {
          rows: [
            {
              position: roomSize === 10 ? 1 : 4,
              name: roomSize === 10 ? "Alice" : "Benny",
              suggestions: [],
            },
          ],
        },
      });
    }
    if (path === "/api/player-identities/batch") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  await page.goto("/json-editor?league=gsc");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "match.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          league: "gsc",
          format: "5v5",
          races_played: 12,
          tracks: ["First", "", "Third", "Fourth"],
          teams: {
            A: {
              players: Object.fromEntries(
                names.map((mii_name, index) => [codes[index], { mii_name }])
              ),
            },
          },
        })
      ),
    });

  const raceSelect = page.getByLabel("Race selection");
  const roomSize = page.locator("label").filter({ hasText: "Room size" }).locator("select");
  await raceSelect.selectOption("2");
  await roomSize.selectOption("11");
  await raceSelect.selectOption("3");
  await roomSize.selectOption("12");
  await raceSelect.selectOption("0");

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The browser test requires a viewport.");
  if (viewport.width >= 768) await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Bulk Extraction", exact: true }).click();
  const bulk = page.getByRole("dialog", { name: "Bulk Extraction" });
  const slot = (race: number) =>
    bulk.getByRole("region", { name: new RegExp(`^Image for Race ${race}(?::|$)`) });
  const run = bulk.getByRole("button", { name: "Run Extraction", exact: true });
  await expect(bulk.getByRole("region", { name: /Image for Race/ })).toHaveCount(12);
  await expect(slot(1).getByRole("heading")).toHaveText("Race 1: First");
  await expect(slot(2).getByRole("heading")).toHaveText("Race 2");
  await expect(run).toBeDisabled();
  const raceList = bulk.getByRole("region", { name: "Race images", exact: true });
  const image = await drawResults(page, false);
  if (viewport.width >= 768) {
    expect(
      await raceList.evaluate((list) => list.scrollHeight - list.clientHeight)
    ).toBeLessThanOrEqual(1);
    const first = await slot(1).boundingBox();
    const second = await slot(2).boundingBox();
    if (!first || !second) throw new Error("The race cards are unavailable.");
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeCloseTo(first.y, 1);
    for (let race = 1; race <= 12; race++) {
      await slot(race)
        .getByLabel("Choose results image")
        .setInputFiles({
          name: `race-${race}-long-results-screenshot.png`,
          mimeType: "image/png",
          buffer: Buffer.from(image, "base64"),
        });
    }
    await expect(bulk.getByText("12 images queued")).toBeVisible();
    expect(
      await raceList.evaluate((list) => list.scrollHeight - list.clientHeight)
    ).toBeLessThanOrEqual(1);
    for (let race = 1; race <= 12; race++) {
      await slot(race).getByRole("button", { name: "Remove image" }).click();
    }
  }
  await page.setViewportSize({ width: Math.min(viewport.width, 680), height: 390 });
  const initialButton = await run.boundingBox();
  if (!initialButton) throw new Error("The extraction button is unavailable.");
  expect(await raceList.evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);
  await raceList.evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  expect(await raceList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  expect((await run.boundingBox())?.y).toBeCloseTo(initialButton.y, 1);
  const listBounds = await raceList.boundingBox();
  if (!listBounds) throw new Error("The race list is unavailable.");
  expect(listBounds.y + listBounds.height).toBeLessThanOrEqual(initialButton.y);

  for (const race of [1, 4]) {
    await slot(race)
      .getByLabel("Choose results image")
      .setInputFiles({
        name: `race-${race}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      });
  }
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyResultsImage(page, image);
  await slot(3).getByRole("button", { name: "Paste image" }).click();
  await expect(bulk.getByText("3 images queued")).toBeVisible();
  const progress = bulk.getByRole("list", { name: "Extraction progress" });
  await expect(progress.getByRole("listitem")).toHaveCount(3);
  await slot(4).getByRole("button", { name: "Remove image" }).click();
  await expect(progress.getByRole("listitem")).toHaveCount(2);
  await slot(4)
    .getByLabel("Choose results image")
    .setInputFiles({
      name: "race-4.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(progress.getByRole("listitem")).toHaveCount(3);
  await expect(progress.getByLabel("Race 3: Queued", { exact: true })).toBeVisible();
  await expect(progress.getByLabel(/^Race 2:/)).toHaveCount(0);
  expect(requests).toBe(0);
  await run.click();
  try {
    await expect.poll(() => requests).toBe(3);
    await expect(slot(1).getByText("Rate limited · Retry queued")).toBeVisible();
    await expect(
      progress.getByLabel("Race 1: Waiting for the rate limit", { exact: true })
    ).toBeVisible();
    await expect(progress.getByLabel("Race 3: Waiting to retry", { exact: true })).toBeVisible();
    await expect(progress.getByLabel("Race 4: Extracting", { exact: true })).toBeVisible();
    await page.waitForTimeout(5_200);
    expect(requests).toBe(3);
  } finally {
    releaseLastImage();
  }
  await expect(slot(1).getByText("Added 1 placement.")).toBeVisible();
  await expect(slot(3).getByText("Could not read the image.")).toBeVisible({ timeout: 10_000 });
  await expect(slot(4).getByText("Added 1 placement.")).toBeVisible();
  await expect(progress.getByLabel("Race 1: Complete", { exact: true })).toBeVisible();
  await expect(progress.getByLabel("Race 3: Failed", { exact: true })).toBeVisible();
  await expect(progress.getByLabel("Race 4: Complete", { exact: true })).toBeVisible();
  await expect(slot(2).getByRole("status")).toHaveCount(1);
  await expect(bulk.getByText("1 image queued")).toBeVisible();
  expect(requests).toBe(5);
  for (const size of [10, 11]) {
    const attempts = attemptsByRoomSize.get(size) ?? [];
    expect(attempts).toHaveLength(2);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(4_900);
  }
  expect(attemptsByRoomSize.get(12)).toHaveLength(1);

  await expect(bulk.getByRole("button", { name: "Return to Editor" })).toHaveCount(0);
  await run.click();
  const returnToEditor = bulk.getByRole("button", { name: "Return to Editor" });
  await expect(returnToEditor).toBeEnabled();
  await returnToEditor.click();
  await expect(bulk).toHaveCount(0);
  expect(requests).toBe(6);
  const playerAt = (position: number) =>
    page.getByRole("combobox", { name: `Player in position ${position}`, exact: true });
  await expect(playerAt(1)).toHaveValue(`A::${codes[0]}`);
  await page.getByLabel("Race selection").selectOption("1");
  await expect(playerAt(1)).toHaveValue("");
  await page.getByLabel("Race selection").selectOption("2");
  await expect(playerAt(4)).toHaveValue(`A::${codes[1]}`);
  await page.getByLabel("Race selection").selectOption("3");
  await expect(playerAt(4)).toHaveValue(`A::${codes[1]}`);
});

test("leaves shared names and uncertain readings for manual review", () => {
  const row = (position: number | null, name: string): RecognizedResultRow => ({
    position,
    name,
    suggestions: [],
  });
  const roster = [
    { key: "a", miiName: "Alex", label: "A Alex" },
    { key: "b", miiName: "Alex", label: "B Alex" },
    { key: "c", miiName: "bey☆name", label: "bey☆name" },
    { key: "d", miiName: "Diana", label: "Diana" },
  ];
  const review = reviewResultsRows(
    [
      row(3, "Alex"),
      row(4, "Alex"),
      row(5, "bey  naxe"),
      row(null, "Diana"),
      { ...row(7, "Diana"), suggestions: [2] },
    ],
    roster,
    10
  );
  expect(review.map(({ position, playerKey }) => [position, playerKey])).toEqual([
    [3, ""],
    [4, ""],
    [5, ""],
    [null, ""],
    [7, ""],
  ]);
  expect(review[0].suggestions.map(({ key }) => key)).toEqual(["a", "b"]);
  expect(review[2].suggestions.map(({ key }) => key)).toEqual(["c"]);
  const [suggested] = reviewResultsRows([{ ...row(9, "ベイ☆"), suggestions: [2] }], roster, 10);
  expect(suggested.playerKey).toBe("");
  expect(suggested.suggestions.map(({ key }) => key)).toEqual(["c"]);
});

test("preselects unique small differences and leaves conflicting or weak matches blank", () => {
  const row = (position: number, name: string): RecognizedResultRow => ({
    position,
    name,
    suggestions: [],
  });
  const roster = [
    { key: "b498", miiName: "ミ★B498", label: "ミ★B498" },
    { key: "bey", miiName: "bey☆name", label: "bey☆name" },
    { key: "sora", miiName: "そらいろ±", label: "そらいろ±" },
    { key: "greek", miiName: "Δάφνη", label: "Δάφνη" },
    { key: "short", miiName: "A★", label: "A★" },
    { key: "astral", miiName: "Nova🟊", label: "Nova🟊" },
  ];
  const matches = reviewResultsRows(
    [
      row(9, "ミ☆B498"),
      row(2, "beyname"),
      row(3, "そらいろ◆"),
      row(4, "Δάφνα"),
      row(5, "A☆"),
      row(6, "ミ★B499"),
      row(7, "Nova☆"),
    ],
    roster,
    10
  );
  expect(matches.map(({ playerKey }) => playerKey)).toEqual([
    "b498",
    "bey",
    "sora",
    "greek",
    "short",
    "",
    "astral",
  ]);

  const competingRows = reviewResultsRows([row(1, "ミ☆B498"), row(9, "ミ★B498")], roster, 10);
  expect(competingRows.map(({ playerKey }) => playerKey)).toEqual(["", ""]);

  const ambiguous = reviewResultsRows(
    [row(9, "ミ±B498")],
    [...roster, { key: "competing", miiName: "ミ◆B498", label: "ミ◆B498" }],
    10
  );
  expect(ambiguous[0].playerKey).toBe("");
  expect(ambiguous[0].suggestions.map(({ key }) => key)).toEqual(["b498", "competing"]);
});

test("matches multiple fill variants without merging different shapes", () => {
  const row = (position: number, name: string): RecognizedResultRow => ({
    position,
    name,
    suggestions: [],
  });
  const roster = [
    { key: "shapes", miiName: "★◇■○", label: "Shapes" },
    { key: "other", miiName: "▽♥", label: "Other" },
  ];
  const matches = reviewResultsRows([row(1, "☆◆□●"), row(2, "▼♡"), row(3, "☆◆□◇")], roster, 10);
  expect(matches.map(({ playerKey }) => playerKey)).toEqual(["shapes", "other", ""]);

  const variants = [...roster, { key: "second", miiName: "☆◇■○", label: "Second" }];
  const [exact, ambiguous] = reviewResultsRows([row(1, "★◇■○"), row(2, "☆◆□●")], variants, 10);
  expect(exact.playerKey).toBe("");
  expect(ambiguous.playerKey).toBe("");
  expect(ambiguous.suggestions.map(({ key }) => key)).toEqual(["shapes", "second"]);

  const repeated = reviewResultsRows([row(1, "☆◆□●"), row(2, "★◆■●")], roster, 10);
  expect(repeated.map(({ playerKey }) => playerKey)).toEqual(["", ""]);
});

test("plans replacements atomically while protecting roles and disconnect awards", () => {
  const race: RaceDraft = {
    raceNumber: 2,
    trackName: "Track",
    roomSize: 10,
    placements: [
      { playerKey: "a", role: "bagger" },
      { playerKey: "b", role: "runner" },
      ...Array(8).fill(null),
    ],
    unplacedResults: [{ playerKey: "c", score: 3, role: null }],
    missingPlayerResults: [],
  };
  const selections = [
    { position: 2, playerKey: "a" },
    { position: 3, playerKey: "c" },
    { position: 4, playerKey: "d" },
  ];
  const fill = planResultsImport(race, "5v5", selections, false);
  expect(fill.changes.map(({ position }) => position)).toEqual([4]);
  expect(Array.from(fill.issues.keys())).toEqual([2, 3]);
  const replace = planResultsImport(race, "5v5", selections, true);
  expect(replace.changes.map(({ position }) => position)).toEqual([1, 2, 4]);
  expect(replace.placements.slice(0, 4)).toEqual([
    null,
    { playerKey: "a", role: "bagger" },
    null,
    { playerKey: "d", role: "runner" },
  ]);
  expect(replace.issues.has(3)).toBe(true);
  expect(race.placements[0]?.playerKey).toBe("a");
  expect(
    planResultsImport(race, "5v5", [...selections, { position: 5, playerKey: "a" }], true).valid
  ).toBe(false);
});
