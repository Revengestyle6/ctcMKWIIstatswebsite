import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const publicRoot = resolve(import.meta.dirname, "../public");
const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../media-manifest.json"), "utf8")
);
const leagueMedia = Object.entries(manifest.leagues).map(([code, media]) => ({ code, ...media }));

const errors = [];
for (const league of leagueMedia) {
  const root = resolve(publicRoot, "media/leagues", league.code);
  const logo = resolve(root, "branding/logo.webp");
  if (league.requireLogo && !existsSync(logo)) errors.push(`${league.code}: missing logo.webp`);

  const backgroundRoot = resolve(root, "backgrounds");
  const images = existsSync(backgroundRoot)
    ? readdirSync(backgroundRoot).filter((name) => name.endsWith(".webp")).sort()
    : [];
  if (images.length !== league.backgroundCount) {
    errors.push(
      `${league.code}: expected ${league.backgroundCount} backgrounds, found ${images.length}`
    );
  }
  for (let index = 0; index < images.length; index += 1) {
    const expected = `${String(index + 1).padStart(3, "0")}.webp`;
    if (images[index] !== expected) {
      errors.push(`${league.code}: expected ${expected}, found ${images[index]}`);
    }
  }
}

for (let index = 1; index <= manifest.sharedAudioTrackCount; index += 1) {
  const track = resolve(publicRoot, `media/audio/shared/track-${String(index).padStart(2, "0")}.mp3`);
  if (!existsSync(track)) errors.push(`shared audio: missing ${track}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("League media inventory is valid.");
}
