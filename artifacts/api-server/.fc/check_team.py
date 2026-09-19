import json, collections, csv, re

o = json.load(open('.fc/outlooks.json'))
logs = json.load(open('data/player/game_logs/2025.json'))

tt = collections.defaultdict(collections.Counter)
weeks = collections.defaultdict(set)
for pid, games in logs.items():
    for g in games:
        t = g.get('team')
        if not t: continue
        st = g.get('stats',{}) or {}
        for k in ('rush_yd','rush_td','pass_yd','pass_td','rec_yd'):
            tt[t][k] += st.get(k,0) or 0
        weeks[t].add(g.get('week'))

# points scored, from the nflverse slate
pts = collections.Counter(); gp = collections.Counter()
for r in csv.DictReader(open('/tmp/claude-1000/-home-runner-workspace/83d0c3df-4f16-470f-84df-fb66624ad4b0/scratchpad/games.csv')):
    if r['season'] != '2025' or r['game_type'] != 'REG': continue
    if not r['away_score'] or not r['home_score']: continue
    pts[r['away_team']] += int(r['away_score']); gp[r['away_team']] += 1
    pts[r['home_team']] += int(r['home_score']); gp[r['home_team']] += 1

teams = list(gp.keys())
def rank_of(d, team, hi=True):
    vals = sorted(d.items(), key=lambda kv: -kv[1] if hi else kv[1])
    for i,(t,_) in enumerate(vals,1):
        if t == team: return i
    return None

ppg   = {t: pts[t]/gp[t] for t in teams}
rushg = {t: tt[t]['rush_yd']/gp[t] for t in teams if gp[t]}
passg = {t: tt[t]['pass_yd']/gp[t] for t in teams if gp[t]}

ALIAS = {'lar':'LA','lv':'LV','lac':'LAC','jax':'JAX','was':'WAS','ne':'NE','no':'NO','nyj':'NYJ','nyg':'NYG','sf':'SF','tb':'TB','gb':'GB','kc':'KC'}
def code(k):
    c = ALIAS.get(k, k.upper())
    return c if c in gp else k.upper()

ORD = lambda n: f"{n}{'th' if 11<=n%100<=13 else {1:'st',2:'nd',3:'rd'}.get(n%10,'th')}"
issues = []
for key, v in sorted(o.items()):
    T = code(key)
    if T not in gp:
        issues.append((key,'team code',f'no 2025 data for {T}')); continue
    for f in v['facts']:
        lab, val, rk = f['label'], f['value'], f.get('rank')
        m = re.match(r'^([\d.]+)', val.replace(',',''))
        if lab == 'Scoring' and m:
            act, ar = ppg[T], rank_of(ppg,T)
            if abs(float(m.group(1))-act) > 0.15: issues.append((key,'Scoring value',f'says {val}, actual {act:.1f}'))
            if rk and rk != ORD(ar): issues.append((key,'Scoring rank',f'says {rk}, actual {ORD(ar)} ({act:.1f} ppg)'))
        if lab == 'Rushing' and m and 'yds/g' in val:
            act, ar = rushg[T], rank_of(rushg,T)
            if abs(float(m.group(1))-act) > 1.0: issues.append((key,'Rushing value',f'says {val}, actual {act:.1f}'))
            if rk and rk != ORD(ar): issues.append((key,'Rushing rank',f'says {rk}, actual {ORD(ar)} ({act:.1f})'))
        if lab == 'Passing' and m and 'yds/g' in val:
            act, ar = passg[T], rank_of(passg,T)
            if abs(float(m.group(1))-act) > 1.0: issues.append((key,'Passing value',f'says {val}, actual {act:.1f}'))
            if rk and rk != ORD(ar): issues.append((key,'Passing rank',f'says {rk}, actual {ORD(ar)} ({act:.1f})'))
        if lab == 'Rushing TDs' and m:
            act = tt[T]['rush_td']
            if abs(float(m.group(1))-act) > 0.5: issues.append((key,'Rushing TDs',f'says {val}, actual {act}'))
        if lab == 'Passing TDs' and m:
            act = tt[T]['pass_td']
            if abs(float(m.group(1))-act) > 0.5: issues.append((key,'Passing TDs',f'says {val}, actual {act}'))

print(f"checked {len(o)} teams' team-level facts against 2025 actuals\n")
if not issues: print("no team-level mismatches")
for k,w,d in issues: print(f"  {k.upper():4} {w:16} {d}")
