import json, collections, re, unicodedata

def norm(n):
    n = unicodedata.normalize('NFKD', n).encode('ascii','ignore').decode()
    return re.sub(r'[^a-z ]','', n.lower()).replace(' jr','').replace(' sr','').replace(' iii','').replace(' ii','').strip()

players = json.load(open('data/player/players.json'))
meta = {}
for p in players:
    if not isinstance(p, dict): continue
    meta[str(p.get('id'))] = {'name': p.get('name') or '', 'pos': p.get('position'), 'team': p.get('team')}

logs = json.load(open('data/player/game_logs/2025.json'))
KEYS = ['rush_att','rush_yd','rush_td','rec','rec_tgt','rec_yd','rec_td','pass_att','pass_cmp','pass_yd','pass_td','pass_int']
season = {}
teamtot = collections.defaultdict(lambda: collections.Counter())
for pid, games in logs.items():
    tot = collections.Counter()
    gp = 0
    teams = collections.Counter()
    for g in games:
        st = g.get('stats',{}) or {}
        played = (st.get('off_snp',0) or 0) > 0 or any((st.get(k,0) or 0) for k in KEYS)
        if played: gp += 1
        for k in KEYS: tot[k] += st.get(k,0) or 0
        if g.get('team'): teams[g['team']] += 1
        if g.get('team'):
            for k in KEYS: teamtot[g['team']][k] += st.get(k,0) or 0
            teamtot[g['team']]['_weeks'] = teamtot[g['team']]['_weeks']
    tot['games'] = gp
    season[str(pid)] = {'tot': dict(tot), 'team': (teams.most_common(1)[0][0] if teams else None)}

by_name = collections.defaultdict(list)
for pid, s in season.items():
    m = meta.get(pid)
    if not m or not m['name']: continue
    by_name[norm(m['name'])].append((pid, m, s))

json.dump({'season':season,'teamtot':{k:dict(v) for k,v in teamtot.items()}}, open('.fc/agg2025.json','w'))
print("players with 2025 logs:", len(season))
print("teams:", len(teamtot))
# sanity: Josh Allen
for key in ['josh allen','james cook','khalil shakir','dj moore','dalton kincaid','keon coleman','ray davis']:
    for pid, m, s in by_name.get(key, []):
        t=s['tot']
        if t.get('pass_yd') or t.get('rush_yd',0)>100 or t.get('rec',0)>20:
            print(f"{m['name']:20} {m['pos']:3} {s['team']:4} g={t['games']:2} "
                  f"pass {t['pass_yd']}/{t['pass_td']}td cmp{t['pass_cmp']}/{t['pass_att']} | "
                  f"rush {t['rush_att']}att {t['rush_yd']}yd {t['rush_td']}td | "
                  f"rec {t['rec']}/{t['rec_tgt']} {t['rec_yd']}yd {t['rec_td']}td")
