import json
import pandas as pd
import numpy as np
from io import StringIO
from pathlib import Path

# Path to THIS file (backend/app.py)
BASE_DIR = Path(__file__).resolve().parent
csv_directory = BASE_DIR / "CSV"
json_directory = BASE_DIR / "JSON"

def findcol(csvfile: str, query: str):
    data = pd.read_csv(csv_directory / csvfile)
    output = set()
    for row in data.itertuples(index=False):
        value = getattr(row, query)
        if isinstance(value, str):
            output.add(value.lower())
        elif pd.isna(value):
            # Skip NaN/empty values
            continue
        else:
            raise ValueError(f"{query} not a valid search option")

    return sorted(output)

def findtracklist(csvfile: str):
    return findcol(csvfile, "track")

def findplayernames(csvfile:str):
    return findcol(csvfile, "player")

def findteamnames(csvfile: str):
    return findcol(csvfile, "team")