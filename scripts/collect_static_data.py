import json, math, time
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs' / 'data'
DATA.mkdir(parents=True, exist_ok=True)

# Public universe IDs used as the starting database. Add more IDs here any time.
UNIVERSE_IDS = [
    920587237, 994732206, 1686885941, 1318971886, 3623096087, 383310974,
    4780543622, 3272915504, 2619619496, 10260193230, 4616652839, 703124385,
    1537690962, 3317771874, 5783922966, 5750914919, 3411100258, 3369863135,
    5244411056, 5154902317, 2534724415, 6035872082, 7436755782, 3808081382,
    3911048909, 3101667897, 5591597781, 6391828308, 4483381587, 6347612712,
    9872472334, 18856080813, 6331902150, 18419913755
]
GENRES = ['Simulator','Roleplay','Anime','Tycoon','Obby','Survival','Horror','Shooter','RNG','Adventure','Incremental','Social','Fighting','Sports']
KEYWORDS = ['simulator','anime','obby','tycoon','rng','horror','escape','garden','hero','pets','brainrot','voice','survival']


def chunks(items, size=50):
    for i in range(0, len(items), size):
        yield items[i:i+size]


def get_json(url, timeout=25):
    try:
        r = requests.get(url, timeout=timeout, headers={'User-Agent':'RoTrendsStatic/2.0'})
        if r.status_code == 200:
            return r.json()
        print('status', r.status_code, url)
    except Exception as e:
        print('request failed', url, e)
    return {}


def discover_more_ids():
    """Best-effort discovery. Roblox discovery endpoints change often, so failures are okay."""
    found = set()
    for kw in KEYWORDS:
        url = f'https://games.roblox.com/v1/games/list?model.keyword={kw}&model.maxRows=40&model.startRows=0'
        payload = get_json(url, timeout=12)
        rows = payload.get('games') or payload.get('data') or []
        for row in rows:
            uid = row.get('universeId') or row.get('universe_id') or row.get('id')
            if uid:
                try:
                    found.add(int(uid))
                except Exception:
                    pass
        time.sleep(0.15)
    return list(found)


def title_hook_score(name):
    s = str(name or '')
    score = 35
    if 16 <= len(s) <= 55:
        score += 18
    if any(ch in s for ch in ['🔥','⭐','💎','🌈','⚡','[',']','+']):
        score += 12
    if any(word in s.lower() for word in ['simulator','obby','anime','tycoon','rng','escape','garden','brainrot','pet','hero','tower']):
        score += 14
    if any(word in s.lower() for word in ['update','new','now','limited','event','x2','x7']):
        score += 10
    return max(0, min(100, score))


def genre_for_game(g):
    text = f"{g.get('name','')} {g.get('description','')}".lower()
    pairs = [('Anime','anime'),('RNG','rng'),('Obby','obby'),('Tycoon','tycoon'),('Horror','horror'),('Simulator','simulator'),('Survival','survival'),('Fighting','fight'),('Social','voice'),('Sports','sport'),('Incremental','incremental')]
    for genre, token in pairs:
        if token in text:
            return genre
    return GENRES[int(g.get('id') or 0) % len(GENRES)]


def fetch_game_details(ids):
    out = []
    for batch in chunks(ids, 50):
        joined = ','.join(str(x) for x in batch)
        out.extend(get_json(f'https://games.roblox.com/v1/games?universeIds={joined}').get('data', []))
        time.sleep(0.2)
    return out


def fetch_votes(ids):
    vote_map = {}
    for batch in chunks(ids, 50):
        joined = ','.join(str(x) for x in batch)
        for v in get_json(f'https://games.roblox.com/v1/games/votes?universeIds={joined}').get('data', []):
            vote_map[v.get('id')] = v
        time.sleep(0.2)
    return vote_map


def fetch_icons(ids):
    icons = {}
    for batch in chunks(ids, 100):
        joined = ','.join(str(x) for x in batch)
        url = f'https://thumbnails.roblox.com/v1/games/icons?universeIds={joined}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false'
        for row in get_json(url).get('data', []):
            icons[row.get('targetId')] = row.get('imageUrl') or ''
        time.sleep(0.2)
    return icons


def fetch_thumbnails(ids):
    thumbs = {}
    for batch in chunks(ids, 50):
        joined = ','.join(str(x) for x in batch)
        url = f'https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds={joined}&countPerUniverse=5&defaults=true&size=768x432&format=Png&isCircular=false'
        payload = get_json(url)
        for row in payload.get('data', []):
            uid = row.get('universeId') or row.get('targetId') or row.get('id')
            images = []
            for t in row.get('thumbnails', []) or []:
                img = t.get('imageUrl')
                if img:
                    images.append(img)
            if uid:
                thumbs[uid] = images
        time.sleep(0.2)
    return thumbs


def score_game(g, votes, icon_url='', thumbnails=None):
    thumbnails = thumbnails or []
    up = votes.get('upVotes', 0) or 0
    down = votes.get('downVotes', 0) or 0
    total = up + down
    rating = (up / total * 100) if total else 0
    players = int(g.get('playing') or 0)
    visits = int(g.get('visits') or 0)
    favs = int(g.get('favoritedCount') or 0)
    likes_per_1k = (up / max(visits, 1)) * 1000
    favs_per_1k = (favs / max(visits, 1)) * 1000
    quality = min(100, (rating or 60) * 0.55 + min(30, likes_per_1k * 10) + min(15, favs_per_1k * 2))
    saturation_penalty = min(35, math.log10(players + 1) * 9)
    opportunity = max(0, min(100, quality + 30 - saturation_penalty))
    trending = max(0, min(100, math.log10(players + 1) * 18 + (rating or 0) * 0.25))
    risk = max(0, min(100, (100 - (rating or 70)) * 0.45 + saturation_penalty * 0.8))
    hook = title_hook_score(g.get('name'))
    thumbnail_score = max(0, min(100, quality * 0.42 + opportunity * 0.20 + trending * 0.16 + hook * 0.22 + (8 if icon_url else 0) + min(8, len(thumbnails) * 1.5)))
    purchase_intent = max(0, min(100, hook * 0.18 + quality * 0.25 + trending * 0.22 + math.log10(players+1)*8 + (8 if any(x in (g.get('name') or '').lower() for x in ['simulator','tycoon','rng','pet','anime']) else 0)))
    monetization = max(0, min(100, quality * .24 + trending * .26 + purchase_intent * .28 + math.log10(players+1)*8))
    session = max(5, min(30, 7 + (rating-60)*0.08 + math.log10(players+1)*1.6 + (2 if genre_for_game(g) in ['Simulator','Tycoon','RNG'] else 0)))
    daily_sessions = (players * 1440) / max(session, 1)
    payer_rate_low = 0.0015 + monetization/100 * 0.004
    payer_rate_high = 0.004 + monetization/100 * 0.014
    arppu_low = 18 + monetization * 0.55
    arppu_high = 45 + monetization * 1.45
    robux_low = daily_sessions * payer_rate_low * arppu_low
    robux_high = daily_sessions * payer_rate_high * arppu_high
    rpv_proxy = (robux_low + robux_high) / 2 / max(daily_sessions, 1)
    thumb_ctr_low = max(0.2, min(3.5, thumbnail_score / 35))
    thumb_ctr_high = max(0.8, min(8.5, thumbnail_score / 14))
    ad_fit = max(0, min(100, thumbnail_score*.55 + trending*.25 + quality*.20))
    updated = g.get('updated') or g.get('created')
    return {
        'universe_id': g.get('id'), 'place_id': g.get('rootPlaceId'), 'name': g.get('name') or 'Unknown',
        'creator': (g.get('creator') or {}).get('name') or 'Unknown',
        'description': g.get('description') or '', 'genre': genre_for_game(g),
        'players': players, 'visits': visits, 'favorites': favs, 'rating': rating,
        'up_votes': up, 'down_votes': down, 'quality_score': round(quality, 1),
        'opportunity_score': round(opportunity, 1), 'trending_score': round(trending, 1),
        'risk_score': round(risk, 1), 'likes_per_1k_visits': round(likes_per_1k, 3),
        'favorites_per_1k_visits': round(favs_per_1k, 3), 'updated': updated,
        'icon_url': icon_url, 'thumbnails': thumbnails,
        'title_hook_score': round(hook, 1), 'thumbnail_score': round(thumbnail_score, 1),
        'thumb_ctr_low': round(thumb_ctr_low, 2), 'thumb_ctr_high': round(thumb_ctr_high, 2),
        'purchase_intent_score': round(purchase_intent, 1), 'monetization_score': round(monetization, 1),
        'estimated_daily_sessions': round(daily_sessions), 'session_estimate_minutes': round(session, 1),
        'estimated_robux_day_low': round(robux_low), 'estimated_robux_day_high': round(robux_high),
        'rpv_proxy': round(rpv_proxy, 3), 'ad_fit_score': round(ad_fit, 1)
    }


def collect_games():
    ids = sorted(set(UNIVERSE_IDS + discover_more_ids()))[:350]
    details = fetch_game_details(ids)
    ids = [int(g.get('id')) for g in details if g.get('id')]
    votes = fetch_votes(ids)
    icons = fetch_icons(ids)
    thumbs = fetch_thumbnails(ids)
    games = [score_game(g, votes.get(g.get('id'), {}), icons.get(g.get('id'), ''), thumbs.get(g.get('id'), [])) for g in details]
    games.sort(key=lambda x: x['players'], reverse=True)
    return games


def collect_limiteds():
    payload = get_json('https://www.rolimons.com/itemapi/itemdetails', timeout=25)
    raw = payload.get('items', {}) if isinstance(payload, dict) else {}
    out = []
    for item_id, arr in list(raw.items())[:1000]:
        try:
            name = arr[0] if len(arr) > 0 else 'Unknown'
            acronym = arr[1] if len(arr) > 1 else ''
            rap = int(arr[2] or 0) if len(arr) > 2 else 0
            value = int(arr[3] or rap or 0) if len(arr) > 3 else rap
            demand = arr[5] if len(arr) > 5 else 0
            trend = arr[6] if len(arr) > 6 else 0
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
games = collect_games()
write('games.json', {'meta': {'updated_at': now, 'source': 'Roblox public APIs + proxy scoring', 'count': len(games), 'note': 'Revenue and thumbnail CTR are estimates from public metrics, not private Roblox analytics.'}, 'games': games})
limiteds = collect_limiteds()
write('limiteds.json', {'meta': {'updated_at': now, 'source': 'Rolimons public itemdetails', 'count': len(limiteds)}, 'items': limiteds})
print('done', len(games), 'games', len(limiteds), 'limiteds')