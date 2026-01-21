import extract
import stats
import find
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
csv_directory = BASE_DIR / "CSV"
json_directory = BASE_DIR / "JSON"

extract.extract(str(json_directory / "ctc_s1_d3"), str(csv_directory / "ctc_d3.csv"))
extract.extract(str(json_directory / "ctc_s1_d4"), str(csv_directory / "ctc_d4.csv"))