import json, re, collections, unicodedata

def norm(n):
    n = unicodedata.normalize('NFKD', n).encode('ascii','ignore').decode()
    n = re.sub(r"[.'']", '', n.lower())
    n = re.sub(r'\b(jr|sr|ii|iii|iv)\b', '', n)
    return re.sub(r'[^a-z ]',' ', n).split()

players = json.load(open('data/player/players.json'))
logs = json.load(open('data/player/game_logs/2025.json'))
K = ['rush_att','rush_yd','rush_td','rec','rec_tgt','rec_yd','rec_td','pass_att','pass_cmp','pass_yd','pass_td','pass_int']
agg = {}
for pid, games in logs.items():
    t = collections.Counter(); gp = 0
    for g in games:
        st = g.get('stats',{}) or {}
        if (st.get('off_snp',0) or 0) > 0 or any(st.get(k,0) for k in K): gp += 1
        for k in K: t[k] += st.get(k,0) or 0
    t['games'] = gp; agg[str(pid)] = t

idx = collections.defaultdict(list)
for p in players:
    key = ' '.join(norm(p.get('name') or ''))
    if key: idx[key].append(p)

def find(name, team):
    key = ' '.join(norm(name))
    cands = idx.get(key, [])
    if not cands: return None, None
    withlogs = [c for c in cands if str(c['id']) in agg]
    pool = withlogs or cands
    same = [c for c in pool if (c.get('team') or '').upper() == team]
    pick = (same or pool)[0]
    return pick, agg.get(str(pick['id']))

o = json.load(open('.fc/outlooks.json'))
ALIAS = {'lar':'LA'}
def code(k): return ALIAS.get(k, k.upper())

def cands_for(unit, a):
    tot_td = a['rush_td'] + a['rec_td'] + a['pass_td']
    return {
      'pass yds':[a['pass_yd']], 'pass td':[a['pass_td']],
      'rush yds':[a['rush_yd']], 'rush td':[a['rush_td']],
      'rec yds':[a['rec_yd']], 'rec':[a['rec']], 'targets':[a['rec_tgt']],
      'td':[a['rush_td'], a['rec_td'], tot_td, a['rush_td']+a['rec_td'], a['pass_td']],
      'games':[a['games']], 'carries':[a['rush_att']], 'att':[a['pass_att'], a['rush_att']],
      'yds':[a['rec_yd'], a['rush_yd'], a['pass_yd']],
      'ypc':[round(a['rush_yd']/a['rush_att'],1) if a['rush_att'] else None,
             round(a['rec_yd']/a['rec'],1) if a['rec'] else None],
      'ypr':[round(a['rec_yd']/a['rec'],1) if a['rec'] else None],
      'scrimmage':[a['rush_yd']+a['rec_yd']],
      'touches':[a['rush_att']+a['rec']],
      'ypt':[round((a['rush_yd']+a['rec_yd'])/(a['rush_att']+a['rec']),1) if (a['rush_att']+a['rec']) else None],
      'ypt_tgt':[round(a['rec_yd']/a['rec_tgt'],1) if a['rec_tgt'] else None],
    }.get(unit, [])

def classify(s):
    s = s.lower()
    # Rates FIRST: "14.1 yds/rec" is a rate, not a receiving-yards total.
    if '/carry' in s or '/car' in s or 'per carry' in s: return 'ypc'
    if '/rec' in s or 'per rec' in s or 'per catch' in s: return 'ypr'
    if '/touch' in s or 'per touch' in s: return 'ypt'
    if '/target' in s or 'per target' in s: return 'ypt_tgt'
    if 'rz' in s or 'red zone' in s or 'red-zone' in s: return None  # not in local data
    if 'scrimmage' in s: return 'scrimmage'
    if 'touches' in s or re.search(r'\btouch\b', s): return 'touches'
    if 'pass' in s and ('yd' in s or 'yard' in s): return 'pass yds'
    if 'pass' in s and 'td' in s: return 'pass td'
    if 'rush' in s and ('yd' in s or 'yard' in s): return 'rush yds'
    if 'rush' in s and 'td' in s: return 'rush td'
    if 'rec' in s and ('yd' in s or 'yard' in s): return 'rec yds'
    if 'target' in s: return 'targets'
    if re.search(r'\brec\b|catch|reception', s): return 'rec'
    if 'game' in s: return 'games'
    if 'carr' in s or re.search(r'\batt\b', s): return 'carries'
    if re.search(r'\btd\b|touchdown|score', s): return 'td'
    if 'yd' in s or 'yard' in s: return 'yds'
    return None

issues = []; nomatch = []; checked = 0
for tk, v in sorted(o.items()):
    T = code(tk)
    for grp in v['groups']:
        for pl in grp['players']:
            p, a = find(pl['name'], T)
            if a is None:
                nomatch.append((tk, pl['name'], 'no 2025 game log' if p else 'not in players.json'))
                continue
            parts = []
            for stat in pl['stats']:
                for piece in re.split(r',\s+(?=\d)', stat):
                    parts.append(piece.strip())
            for stat in parts:
                m = re.match(r'^([\d,]+(?:\.\d+)?)\s*(.*)$', stat.strip())
                if not m: continue
                val = float(m.group(1).replace(',','')); unit = classify(m.group(2) or stat)
                if not unit: continue
                cs = [c for c in cands_for(unit, a) if c is not None]
                if not cs: continue
                checked += 1
                if not any(abs(val-c) <= (0.15 if unit in ('ypc','ypr') else 0.5) for c in cs):
                    issues.append((tk, pl['name'], stat, unit, cs))

print(f"checked {checked} numeric claims across {len(o)} teams")
print(f"\n--- {len(issues)} stat lines matching no interpretation ---")
for tk,n,s,u,cs in issues:
    print(f"  {tk.upper():4} {n:22} \"{s}\"  ({u}; data says {cs})")
print(f"\n--- {len(nomatch)} players not resolvable in local data ---")
for tk,n,why in nomatch: print(f"  {tk.upper():4} {n:22} {why}")
