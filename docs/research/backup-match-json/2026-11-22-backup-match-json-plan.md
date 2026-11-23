# Backup match JSON creation

Planning notes · 2026-11-22

When MKW Table Bot is unavailable, players need a faster way to build a match document and table from the evidence they already have. Start with roster import and one-race screenshot import so players can fill in a race between races. Investigate Wiimmfi room history alongside that work. Whole-war video import can reuse the results reader once it works on individual screenshots.

Each import would propose edits to the existing match draft. Players could use the normal controls to edit teams, players, race order, tracks, placements, room size, and disconnect awards. The match compiler already derives points from placement and room size, and the editor can preview the compiled match as a table. [Teams And Players](../../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L2783) · [Race Entry](../../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L3094) · [Match compiler](../../../frontend/src/features/match-editor/matchJsonEditorModel.ts#L380) · [Table preview](../../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L1879)

## Roster import

- Offer text paste first. The example Discord VR output includes Lounge name, Mii name, and friend code in fixed columns. Check whether rows copied from the Wiimmfi page provide a usable text or table representation too.
- Accept pasted images or image files. For Wiimmfi screenshots, crop to the friend-code and Mii-name columns and associate cells by their vertical position. For VR screenshots, include the Lounge-name column. Preserve friend codes as strings with leading zeros and flag uncertain digits or duplicate codes for review.
- Suggest teams using repeated tag patterns in the full Mii names, selected match teams, and known roster matches. The examples include tags followed by spaces, symbols, and brackets. A Wiimmfi sample includes `GAMT Eric` and `GAMT◇D`, which belong in the same proposed group. Keep team assignments editable and preserve each player's full Mii name for results matching. Use friend codes for player identity lookup. [Identity and participation terminology](../../../CONTEXT.md#identity-and-participation)

## Race results screenshot

Add an **Import results image** button in Race Entry for the selected race, with a popup for image paste or selection, original image review, and applying recognized placements. Read the position at the left and the Mii name in the middle. The example also contains two points columns, and the editor already computes the race scores. The player enters the track manually and can correct placements or add disconnect awards afterward. [Room-size score tables](../../../frontend/src/features/match-editor/matchJsonEditorModel.ts#L141)

Apply only one-to-one roster matches. When a Mii name is shared by two players, leave both relevant positions blank for manual entry. Show suggestions for uncertain readings, such as names containing `☆`, `±`, or stylized letters, beside the source row. Preserve the position numbers when the screenshot is cropped or a row is unreadable. Use the chosen room size and review unexpected row counts. Keep existing entries unless the player explicitly chooses to replace them.

Try Tesseract.js for browser-side OCR. Load the worker on the first image import, reuse it for later images, and recognize cropped regions. Measure cold and warm latency and accuracy on the supplied layouts and on typical player devices. Browser-side processing keeps source screenshots on the user's device and avoids per-image OCR service charges. Keep image data and popup previews in editor memory and release them on successful match upload, editor clear, or exit. Store and submit only the resulting match fields. [Tesseract.js](https://github.com/naptha/tesseract.js)

## Wiimmfi room history

The published Table Bot source reads Wiimmfi room-history HTML and parses race headers and player rows. If those records are available when only Table Bot is down, a room-history import could supply the roster, track names, and finishes in one pass. The live Wiimmfi page returned HTTP 403 during the research check. Current access, room retention, and behavior after a restart still need verification. Compare room-history output with a reviewed war, including disconnects and tied or missing finish times, before trusting derived placement. Players can use the text and image paths when room history is inaccessible or incomplete. [Table Bot room lookup](https://github.com/BadWolf1023/MKW-Table-Bot/blob/main/WiimmfiSiteFunctions.py) · [Wiimmfi room-history parser](https://github.com/BadWolf1023/MKW-Table-Bot/blob/main/WiimmfiParser.py)

## Whole-war video import

Start with a local MP4 and an optional start and end time. Use the existing roster or import one from the VR or Wiimmfi source. Return an editable draft race for each distinct results board found in the selected range, with timestamps and source previews for review. The player can add, remove, reorder, or edit races normally.

1. Scan low-resolution frames at roughly one frame per second for distinctive course-vote and race-results layouts. Sample more densely around detected transitions. In results windows, choose a sharp, fully loaded board using the stability and visibility of the position and name regions.
2. On the vote screen, look for the decision footer and yellow **text** in the selected course label. The yellow border during selection is a separate signal. In the supplied example, the yellow label selects N64 Sherbet Land. Read the winning label crop with OCR and resolve it against the selected league's track catalog and aliases. Treat the lower-left race-intro title as supplemental evidence when it appears. [Track lookup in Race Entry](../../../frontend/src/features/match-editor/MatchJsonEditor.tsx#L3160)
3. Read the board with the same placement reader used for screenshots. Group adjacent frames of the same screen, and pair each result with a vote in the corresponding race window. A missing or unclear vote leaves a blank track field on that race. Repeated tracks, room restarts, and orphan results should be easy to inspect by timestamp.

A 40-minute recording sampled at one frame per second yields about 2,400 screen checks. A clean 12-race recording would ideally need around 24 selected screens for recognition, plus retries. That estimate covers selected images only. Compressed-video decoding has its own cost because a sampled frame may depend on other frames in the recording. Benchmark browser decoding and total time on representative hardware. If video processing needs server compute, evaluate a bounded worker separate from the normal request path with caps on input length and concurrency. Carry the same ephemeral-media design into any video-processing option. [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) · [FFmpeg frame-rate filter](https://www.ffmpeg.org/ffmpeg-filters.html#fps)

Consider YouTube and Twitch links after proving the local-file workflow and confirming supported access to frame data for the selected time range. YouTube's API policies restrict downloading audiovisual content, and Twitch documents VOD metadata and embedding. Both platforms offer creator downloads that can feed the local MP4 workflow. [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies) · [YouTube creator downloads](https://support.google.com/youtube/answer/56100) · [Twitch VOD API](https://dev.twitch.tv/docs/api/videos/) · [Twitch creator downloads](https://help.twitch.tv/s/article/video-on-demand)

### Minimap fallback

If recordings frequently skip or obscure the vote screen, compare the stable minimap shape across a few frames with reference images. Racer icons, a moving background, and video overlays can interfere with a single crop. Test reference matching before a lightweight classifier. A classifier may be cheap to run, but its training and update burden needs to earn its keep through better coverage. CTGP's catalog changes as courses are added, removed, and revised, so test historical clips and leave uncertain or unknown tracks for review. [CTGP update history](https://www.chadsoft.co.uk/download/updates.html)

## Evaluation

Compare time to a correct table with manual entry for real wars, including 10- and 12-player boards, stylized or duplicate names, substitutions, disconnects, cropped screens, low-bitrate footage, repeated tracks, and missed vote screens. Measure correct fills, incorrect fills, and unresolved fields separately. For video, also measure races missed or counted twice, votes paired to the wrong race, total run time, and peak resource use. Prioritize accuracy of applied placements and how quickly players can finish correcting the draft.
