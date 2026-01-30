import json
import find
import pandas as pd
import numpy as np
from io import StringIO
from pathlib import Path

# Path to THIS file (backend/app.py)
BASE_DIR = Path(__file__).resolve().parent
csv_directory = BASE_DIR / "CSV"
json_directory = BASE_DIR / "JSON"


def findplayeravg(player: str, track="", division="1_2", team=""):
    data = pd.read_csv(csv_directory / f"ctc_d{division}.csv")

    playerset = find.findplayernames(f"ctc_d{division}.csv")
    tracklist = find.findtracklist(f"ctc_d{division}.csv")

    if player.lower() not in playerset: raise ValueError(f"Invalid Player Name, Valid Players: {playerset}")

    scorelist = []
    avg = 0.0
    playername = player
    trackname = track
    teamname = ""  # Initialize as empty string
    
    if track != "":
        if track.lower() not in tracklist: raise ValueError(f"Invalid Track Name, Valid Tracks: {tracklist}")
        for row in data.itertuples(index=False):
            if row.player.lower() == player.lower() and row.track.lower() == track.lower() and row.score <=15:
                scorelist.append(row.score)
                playername = row.player
                trackname = row.track
        for score in scorelist:
            avg += score/len(scorelist)
        return round(avg,1), playername, trackname, round(len(scorelist))
    else:
        for row in data.itertuples(index=False):
            if row.player.lower() == player.lower():
                if row.team.lower() == team.lower() or team == "":
                    scorelist.append(row.score)
                    playername = row.player
                    teamname = row.team  # Capture team name from each row
        
        if scorelist:  # Only calculate average if we have scores
            for score in scorelist:
                avg += score*12/len(scorelist)
        
        return round(avg,1), playername, teamname, round(len(scorelist))

def findteamavg(team: str, track :str, division="1_2"):
    data = pd.read_csv(csv_directory / f"ctc_d{division}.csv")
    teamlist = find.findteamnames(f"ctc_d{division}.csv")
    tracklist = find.findtracklist(f"ctc_d{division}.csv")

    if team.lower() not in teamlist: raise ValueError(f"Invalid Player Name, Valid Teams: {teamlist}")
    if track.lower() not in tracklist: raise ValueError(f"Invalid Track Name, Valid Tracks: {tracklist}")

    scorelist = []
    avg = 0.0
    teamname = team
    trackname = track

    for row in data.itertuples(index=False):
        if row.team.lower() == team.lower() and row.track.lower() == track.lower() and row.score <=15:
            scorelist.append(row.score)
            teamname = row.team
            trackname = row.track
    for score in scorelist:
        avg += score/(len(scorelist)/5)
    #print(f"{teamname} - {trackname} - {round(avg,1)} pts ({round(avg-(61-round(avg,1)),1)}) per race - {round(len(scorelist)/5,0)} races", )
    return round(avg,1), teamname, trackname, round(len(scorelist)/5)

def findtopteamtracks(team: str, min_races = 2, division="1_2"):
    teamlist = find.findteamnames(f"ctc_d{division}.csv")
    tracklist = find.findtracklist(f"ctc_d{division}.csv")
    output = dict()

    if team.lower() not in teamlist: raise ValueError(f"Invalid Player Name, Valid Teams: {teamlist}")
    for t in tracklist:
        avg, _, trackname, races = findteamavg(team, t, division)
        if races >= min_races:
            output[trackname] = (avg, races)

    sorted_tracks = sorted(output.items(), key=lambda x: x[1], reverse=True)

    print(sorted_tracks)
    
    return [f"{track} - {avg} pts ({races} races)" for track, (avg, races) in sorted_tracks]
    
def findtopplayertracks(player: str, min_races = 2, division="1_2"):
    playerlist = find.findplayernames(f"ctc_d{division}.csv")
    tracklist = find.findtracklist(f"ctc_d{division}.csv")
    output = dict()

    if player.lower() not in playerlist: raise ValueError(f"Invalid Player Name, Valid Teams: {playerlist}")
    for t in tracklist:
        avg, _, trackname, races = findplayeravg(player, t, division)
        if races >= min_races:
            output[trackname] = (avg, races)

    sorted_tracks = sorted(output.items(), key=lambda x: x[1], reverse=True)

    print(sorted_tracks)
    
    return [f"{track} - {avg} pts ({races} races)" for track, (avg, races) in sorted_tracks]

def findtopteamplayers(team: str, min_races = 12, division="1_2"):
    teamlist = find.findteamnames(f"ctc_d{division}.csv")
    playerlist = find.findplayernames(f"ctc_d{division}.csv")
    output = dict()

    if team.lower() not in teamlist: raise ValueError(f"Invalid Player Name, Valid Teams: {teamlist}")
    for p in playerlist:
        avg, playername, _, races = findplayeravg(p, "", division, team)
        if races >= min_races:
            output[playername] = (avg, races)

    sorted_players = sorted(output.items(), key=lambda x: x[1], reverse=True)
    print(sorted_players)

    return [f"{player} - {avg} pts ({races} races)" for player, (avg, races) in sorted_players] 

def findtoptracks(track: str, min_races = 2, division="1_2"):
    playerlist = find.findplayernames(f"ctc_d{division}.csv")
    tracklist = find.findtracklist(f"ctc_d{division}.csv")
    output = dict()

    if track.lower() not in tracklist: raise ValueError(f"Invalid Track Name, Valid Tracks: {tracklist}")
    for p in playerlist:
        avg, playername, _, races = findplayeravg(p, track, division)
        if races >= min_races:
            output[playername] = (avg, races)

    sorted_players = sorted(output.items(), key=lambda x: x[1], reverse=True)

    print(sorted_players)
    
    return [f"{player} - {avg} pts ({races} races)" for player, (avg, races) in sorted_players]

def findtopteamsontrack(track: str, min_races = 2, division="1_2"):
    teamlist = find.findteamnames(f"ctc_d{division}.csv")
    tracklist = find.findtracklist(f"ctc_d{division}.csv")
    output = dict()

    if track.lower() not in tracklist: raise ValueError(f"Invalid Track Name, Valid Tracks: {tracklist}")
    for t in teamlist:
        avg, teamname, _, races = findteamavg(t, track, division)
        if races >= min_races:
            output[teamname] = (avg, races)

    sorted_teams = sorted(output.items(), key=lambda x: x[1], reverse=True)

    print(sorted_teams)
    
    return [f"{team} - {avg} pts ({races} races)" for team, (avg, races) in sorted_teams]