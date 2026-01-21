import json
import pandas as pd
import numpy as np
from io import StringIO
from pathlib import Path

# Path to THIS file (backend/app.py)
BASE_DIR = Path(__file__).resolve().parent
csv_directory = BASE_DIR / "CSV"
json_directory = BASE_DIR / "JSON"

header = ['team','player','track','score']


def load(str):
    json_str = str
    return json.load(json_str)

def extract(foldername: str, outputdirectory: str):
    folder = Path(BASE_DIR / foldername)
    finaloutput = []

    for file in folder.glob("*.txt"):
        with open(file, "r", encoding="utf-8") as f:
            data = load(f)

        for team_name, team_data in data['teams'].items():
            for player_id, player_data in team_data['players'].items():
                race_scores = player_data['race_scores']
                player_name = (player_data['lounge_name']) if player_data['lounge_name'] != "" else player_data['mii_name']
                
                x = 0 # this adds races into the csv
                for score in race_scores:
                    if score <= 15:
                        tempoutput = list()
                        tempoutput.append(team_name)
                        tempoutput.append(player_name) if score > 1 else tempoutput.append(player_name+" (bag)")
                        try:
                            tempoutput.append(data['tracks'][x])
                            x+=1
                        except:
                            continue
                        tempoutput.append(score)
                        finaloutput.append(tempoutput)
    df = pd.DataFrame(finaloutput, columns=header)
    df.to_csv(outputdirectory, index=False)
    pass

