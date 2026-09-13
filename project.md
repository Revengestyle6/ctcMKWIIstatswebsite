# Project Instructions

## Required end-of-work CI validation

Before considering any work complete, scan the backend for Ruff lint and formatting errors, fix every error found, and rerun both checks until they pass:

```bash
ruff check backend
ruff format backend --check
```

If the formatting check reports files that would be reformatted, run `ruff format backend`, then rerun both checks. Do not leave Ruff failures for CI to discover.
