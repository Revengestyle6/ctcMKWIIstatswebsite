import extract
import stats
import find

print(find.findplayernames("ctc_d1_2.csv"))
print(find.findtracklist("ctc_d1_2.csv"))
print(find.findteamnames("ctc_d1_2.csv"))
print(stats.findplayeravg("end", "strobenz desert illusion"))
print(stats.findplayeravg("jack"))
print(stats.findteamavg("sts", "sandstone cliffs"))
print(stats.findtopteamtracks("flag"))
print(stats.findtopplayertracks("lawrence"))