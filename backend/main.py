import extract
import stats
import find
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
csv_directory = BASE_DIR / "CSV"
json_directory = BASE_DIR / "JSON"

stats.findplayeravg("zilla")