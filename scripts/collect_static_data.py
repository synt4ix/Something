import json, math, time
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs' / 'data'
DATA.mkdir(parents=True, exist_ok=True)

UNIVERSE_IDS = [920587237, 994732206, 1686885941, 1318971886, 3623096087, 383310974, 4780543622, 3272915504, 2619619496, 10260193230, 4616652839, 703124385, 1537690962, 3317771874, 5783922966, 5750914919, 3411100258, 3369863135, 5244411056, 5154902317, 2534724415, 6035872082]
GENRES = ['Simulator','Roleplay','Anime','Tycoon','Obby','Survival','Horror','Shooter','RNG','Adventure']

def get_json(url, timeout=20):
    try:
        r = requests.get(url, timeout=timeout, headers={'User-Agent':'RoTrendsStatic/1.0'})
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print('request failed', url, e)
    return {}

def score_game(g, votes):
    up = votes.get('upVotes', 0) or 0
    down = votes.get('downVotes', 0) or 0
    total = up + down
    rating = (up / total * 100) if total else None
    players = int(g.get('playing') or 0)
    visits = int(g.get('visits') or 0)
    favs = int(g.get('favoritedCount') or 0)
    likes_per_1k = (up / max(visits, 1)) * 1000
    favs_per_1k = (favs / max(visits, 1)) * 1000
    quality = min(100, (rating or 60) * 0.55 + min(30, likes_per_1k * 10) + min(15, favs_per_1k * 2))
    saturation_penalty = min(35, math.log10(players + 1) * 9)
    opportunity = max(0, min(100, quality + 30 - saturation_penalty))
    trending = max(0, min(100, math.log10(players + 1) * 18 + (rating or 0) * 0.25))
    updated = g.get('updated') or g.get('created')
    risk = max(0, min(100, (100 - (rating or 70)) * 0.45 + saturation_penalty * 0.8))
    return {
        'universe_id': g.get('id'), 'place_id': g.get('rootPlaceId'), 'name': g.get('name') or 'Unknown',
        'creator': (g.get('creator') or {}).get('name') or 'Unknown',
        'description': g.get('description') or '', 'genre': GENRES[int(g.get('id') or 0) % len(GENRES)],
        'players': players, 'visits': visits, 'favorites': favs, 'rating': rating,
        'up_votes': up, 'down_votes': down, 'quality_score': round(quality, 1),
        'opportunity_score': round(opportunity, 1), 'trending_score': round(trending, 1),
        'risk_score': round(risk, 1), 'likes_per_1k_visits': round(likes_per_1k, 3),
        'favorites_per_1k_visits': round(favs_per_1k, 3), 'updated': updated,
        'icon_url': ''
    }

def collect_games():
    ids = ','.join(str(x) for x in UNIVERSE_IDS)
    details = get_json(f'https://games.roblox.com/v1/games?universeIds={ids}').get('data', [])
    votes = get_json(f'https://games.roblox.com/v1/games/votes?universeIds={ids}').get('data', [])
    vote_map = {v.get('id'): v for v in votes}
    games = [score_game(g, vote_map.get(g.get('id'), {})) for g in details]
    games.sort(key=lambda x: x['players'], reverse=True)
    return games

def collect_limiteds():
    payload = get_json('https://www.rolimons.com/itemapi/itemdetails', timeout=25)
    raw = payload.get('items', {}) if isinstance(payload, dict) else {}
    out = []
    for item_id, arr in list(raw.items())[:500]:
        try:
            name = arr[0]; acronym = arr[1]; rap = int(arr[2] or 0); value = int(arr[3] or rap or 0); demand = arr[5]; trend = arr[6]
            projected = bool(arr[7]) if len(arr) > 7 else False
            hyped = bool(arr[8]) if len(arr) > 8 else False
            rare = bool(arr[9]) if len(arr) > 9 else False
            gap = value - rap
            risk = (45 if projected else 0) + (25 if hyped else 0) + max(0, -gap / max(value, 1) * 50)
            deal = max(0, min(100, 50 + gap / max(value, 1) * 100 - risk * 0.45))
            liquidity = max(0, min(100, 80 - math.log10(max(value, 1)) * 7 + (10 if demand in [3,4] else 0)))
            out.append({'item_id': int(item_id), 'name': name, 'acronym': acronym, 'rap': rap, 'value': value, 'demand': demand, 'trend': trend, 'projected': projected, 'hyped': hyped, 'rare': rare, 'value_gap': gap, 'deal_score': round(deal,1), 'risk_score': round(risk,1), 'liquidity_score': round(liquidity,1)})
        except Exception:
            continue
    out.sort(key=lambda x: x['deal_score'], reverse=True)
    return out

def write(name, payload):
    (DATA / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

now = datetime.now(timezone.utc).isoformat()
write('games.json', {'meta': {'updated_at': now, 'source': 'Roblox public APIs', 'count': len(collect_games())}, 'games': collect_games()})
limiteds = collect_limiteds()
write('limiteds.json', {'meta': {'updated_at': now, 'source': 'Rolimons public itemdetails', 'count': len(limiteds)}, 'items': limiteds})
print('done')
