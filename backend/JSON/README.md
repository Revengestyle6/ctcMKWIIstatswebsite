# Historical match archive

Checked-in Table Bot documents are bootstrap/rebuild inputs, organized as:

```text
backend/JSON/{league}/{season}/{division}/{match}.json
```

Season 1 includes the historical combined division `ctc/s1/d1_2`. Some source
payloads retain a `.txt` extension; the importer prefers a `.json` file when both
share a stem. Keep historical evidence and the reviewed registries in
`backend/data/` together when rebuilding a database.

New accepted editor uploads use the configured archive storage adapter. Hosted
staging uses Cloud Storage; local development defaults to ignored local object
storage. Runtime acceptance does not commit files to this repository or populate
this historical directory.

See [data pipeline](../../docs/architecture/data-pipeline.md),
[JSON format](../../docs/json-editor/json-format.md), and
[editor workflow](../../docs/json-editor/workflow.md) for import and archive rules.
