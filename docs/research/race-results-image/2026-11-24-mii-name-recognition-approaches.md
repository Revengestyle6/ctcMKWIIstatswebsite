# Improving Mii-name recognition in race results images

Investigation date November 24, 2026. This note compares three proposed approaches. Accuracy,
latency, and operating cost on real imports remain unmeasured.

## Current behavior and recommendation

The importer detects the results table, corrects its tilt, and separates each row into
finishing-position and Mii-name crops. It runs the English Tesseract model in the browser, matches
name readings against the editor roster, and presents placements for review. Reports of Greek,
Japanese, and symbol errors make name recognition the first problem to isolate. Inspect the original
and processed name crops before attributing every failure to OCR. A narrow crop or lost stroke can
affect any recognizer.
[Table geometry](../../../frontend/src/features/match-editor/raceResultsGeometry.ts) ·
[OCR pipeline](../../../frontend/src/features/match-editor/raceResultsOcr.ts) ·
[Roster matching](../../../frontend/src/features/match-editor/raceResultsImport.ts) ·
[Import workflow](../../json-editor/race-results-image.md)

Start with a hosted vision benchmark and collect exact-text labels at the same time. Try confirmed
visual examples for recurring names within a match. Train a detector if the benchmark shows that
crop or row pairing errors account for a meaningful share of missed placements. A game-specific OCR
model is the strongest longer-term candidate if browser-only processing is a priority.

| Approach | What it learns or uses | Main effort | Likely deployment tradeoff |
| --- | --- | --- | --- |
| Lightweight vision LLM | Existing vision model plus the current roster | Evaluation, backend integration, and request controls | Low initial effort, metered API calls, and off-device processing |
| Object detection and visual player matching | Generic position/name boxes plus confirmed visual examples | Box labeling if localization needs work, plus visual matching | Potential browser inference with additional model assets and device testing |
| Game-specific OCR | Labeled name crops and a bank of letters and symbols | Unicode labeling, model training, and evaluation across capture conditions | Potential browser inference with no per-import API fee. Training and maintaining the recognizer are the principal costs |

## 1. Lightweight vision LLM

Run a benchmark with one hosted request per imported race, using a single image that combines
unresolved name crops at readable resolution. Preserve the local row IDs and positions. Send the
current roster as short, request-scoped IDs and the Mii names needed for comparison. Ask for one
candidate ID or `null` per crop. A second benchmark variant can use the cropped results table to see
whether surrounding context helps enough to justify the larger image. GPT-5.6 Luna is one example of
a small model with image input and structured output.
[Model capabilities](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

Check that returned rows exist, player IDs belong to the roster, and each selected player is used
only once. Keep duplicate or ambiguous name matches in manual review. A structurally valid result
can still point to the wrong player, so treat model results as suggestions in the first trial. Test
what happens when the crop is blank, a roster entry is missing, or two available names differ by a
single symbol.
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) ·
[Current placement plan](../../../frontend/src/features/match-editor/raceResultsImport.ts)

**Illustrative API cost.** At the listed standard rates for GPT-5.6 Luna, one 1024×512 image at high
detail costs 615 image input tokens after the documented patch multiplier. With 500 additional input
tokens and 200 billed output tokens, the estimate is
`(615 + 500) × $0.20 / 1,000,000 + 200 × $1.20 / 1,000,000`, or about **$0.46 per 1,000 imports**.
This assumes one request per import and excludes retries, extra reasoning tokens, larger inputs, and
application hosting costs. A whole screenshot or several individual requests can change both cost
and latency. [Model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna) ·
[Image token calculation](https://developers.openai.com/api/docs/guides/images-vision#calculating-costs)

A production hosted fallback would add a server endpoint to protect the API credential and enforce
request limits. Name crops and roster text would leave the browser, a change from the current
workflow. Limit requests to the pixels and roster fields needed, and decide on disclosure and
retention before enabling it for players. Self-hosting is a separate evaluation. Compare compute and
operational costs at expected traffic levels, model startup time, and latency with a warm instance
after establishing that the hosted baseline is accurate enough.
[Current image-handling workflow](../../json-editor/race-results-image.md) ·
[Provider data controls](https://developers.openai.com/api/docs/guides/your-data)

## 2. Object detection and visual player matching

This proposal has three separable jobs. Localization finds position and name boxes. Row pairing
associates each name box with the correct position box. Recognition identifies the player in the
name box. A detector trained on generic box types can improve localization across layouts.
Conventional object detection predicts boxes and categories, so an added recognition step is needed
to identify a player from a generic name box.
[Object detection task definition](https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123460205.pdf)

1. **Localization.** Compare the current row crops against hand-labeled boxes first. If crops
   frequently clip names or swap rows, annotate generic position and name boxes across screenshot
   sizes, capture devices, tilts, backgrounds, and partially visible tables. Fit a lightweight
   detector and measure how often it retains the full glyphs and pairs the correct row.
2. **Position pairing.** Pair the boxes into rows by geometry and read the printed finishing
   positions with the existing OCR path. A missing printed position needs manual review. A crop that
   starts at third place must still assign that row to third place.
3. **Recognition.** Start with confirmed example crops per player from earlier races in the same
   match. Normalize crop scale and alignment, compare each new crop against the current roster's
   examples, and return a suggestion when the closest match is sufficiently distinct. Keep examples
   in match memory for the trial. Defer a classifier with one class per player until visual
   comparisons have been evaluated. Per-player classes would require training data and upkeep as
   players join or change their names.

Visual matching could recover mixed-script or decorative names without first transcribing them. Its
useful coverage depends on having a confirmed reference for the player's current Mii name. Blur,
differing image scales, nearly identical names, and missing references can make visual matches
ambiguous. Evaluate same-match and cross-session performance separately, and put duplicate names
into manual review. Browser deployment is possible with a compatible model and runtime, but model
download, memory, and inference time on phones need measurement.
[Existing table geometry](../../../frontend/src/features/match-editor/raceResultsGeometry.ts) ·
[ONNX Runtime Web inference](https://onnxruntime.ai/docs/tutorials/web/)

## 3. Game-specific OCR

Use the proposed character bank to define the recognizer's output vocabulary. Pair each name crop
with its **exact UTF-8 text**, including Greek letters, kana, kanji, symbols, and any meaningful
spaces. Store the source transcription alongside any normalized version used for comparison. When
Latin and Greek lookalikes or visually identical symbols cannot be distinguished, verify the label
with the roster or a trusted source and record unresolved examples separately. Train on whole name
crops so the model can recognize new sequences of familiar glyphs.

Benchmark multilingual Tesseract as an inexpensive baseline, using the relevant Greek and Japanese
models and comparing lightly processed crops against the original pixels. Then compare either a
fine-tuned Tesseract model or a small scene-text sequence recognizer. The Tesseract trainer supports
image and UTF-8 transcription pairs and continuation from compatible models, including some changes
to the character set. A compact sequence recognizer with a CTC output layer is another option if the
team's character bank and capture examples fit that training workflow. Both require tuning on actual
names from this game.
[Tesseract supported languages](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html)
·
[Tesseract training documentation](https://tesseract-ocr.github.io/tessdoc/tess5/TrainingTesseract-5.html)
·
[SVTRv2 scene-text recognition paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Du_SVTRv2_CTC_Beats_Encoder-Decoder_Models_in_Scene_Text_Recognition_ICCV_2025_paper.pdf)

Collect enough real examples to cover rare glyphs, mixed scripts, thin text, and phone captures.
Synthetic text can supplement rare characters where fonts reproduce them, with real game captures
remaining the basis for evaluation. Keep the raw transcription for diagnosis and resolve the output
against the editor roster for suggestions. Test browser inference and measure first-use download,
warm latency, and memory before selecting a runtime. The main upfront costs are labeling and
training. Browser inference can keep screenshot processing on-device and shifts runtime costs toward
model delivery and device compute.
[Tesseract browser performance guidance](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md)
· [ONNX Runtime Web inference](https://onnxruntime.ai/docs/tutorials/web/)

## Shared benchmark and decision criteria

Use one labeled set for all three approaches. For each row, record the printed position if readable,
the exact Mii name if known, the expected roster ID or unresolved state, and the name and position
crop bounds when testing geometry. Record capture session and quality. Include common Latin names,
Greek and Japanese names, symbols, similar or duplicate names, tilted phone photos, and cropped or
blurry rows.

For a trained recognizer, hold out entire capture sessions and names the model has never seen. Keep
near-duplicate screenshots together to avoid inflating results. For within-match visual matching,
give the system only the references a user would already have confirmed before that race. Compare
the existing importer, hosted vision fallback, and any trained approach on the same held-out inputs.

- Count **wrong player suggestions**, wrong player preselects, correct suggestions, rows left for
  manual selection, and wrong row-position pairings separately.
- Measure exact-name recognition by script and symbol coverage to diagnose misses. Measure the time
  to finish a reviewed race to judge the workflow.
- Record cold and warm latency, shared-model download size, and per-import API usage where
  applicable. Break out direct screenshots and phone captures.
- Include the current importer and manual entry as baselines. Prefer the approach that reduces
  review time while keeping wrong preselects acceptably rare. If most misses come from clipped or
  mispaired rows, prioritize localization. If the crops are sound and language errors dominate,
  prioritize the recognition comparison.
