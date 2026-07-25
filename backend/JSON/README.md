# Match JSON Directory Layout

Store raw `.txt` uploads and processed `.json` match files by league, season, and division:

```text
backend/JSON/{league}/{season}/{division}/
```

Examples:

```text
backend/JSON/ctc/s1/d1_2/
backend/JSON/ctc/s1/d3/
backend/JSON/ctc/s1/d4/
backend/JSON/ctc/s3/d4/
```

Season 1 has a legacy `d1_2` folder because Divisions 1 and 2 were handled together. Future seasons should use one division per folder, such as `d1`, `d2`, `d3`, and `d4`.

When the upload flow exists, it should:

1. Accept the uploaded `.txt` file plus league, season, and division metadata.
2. Parse and validate the file as JSON.
3. Store the original upload and processed JSON in the matching `{league}/{season}/{division}` folder.
4. Insert or update analytics database rows from the processed JSON.

