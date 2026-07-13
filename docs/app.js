const state = { games: [], limiteds: [], meta: {}, page: 1, perPage: 50, selected: null };
const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('en-US');
const compact = n => {
  n = Number(n || 0);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return fmt(Math.round(n));
};
const pct = n => `${Number(n || 0).toFixed(1)}%`;
const money = n => `${compact(n)} R$`;

async function loadJson(path, fallback) {
  try {
    const res = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(path);
    return await res.json();
  } catch {
    return fallback;
  }
}

async function boot() {
  const gp = await loadJson('./data/games.json', { games: [], meta: {} });
  const lp = await loadJson('./data/limiteds.json', { items: [], meta: {} });
  state.games = gp.games || [];
  state.limiteds = lp.items || [];
  state.meta = { games: gp.meta || {}, limiteds: lp.meta || {} };
  state.selected = state.games[0] || null;
  bindNav();
  bindControls();
  buildGenreSelect();
  renderAll();
}

function bindNav() {
  document.querySelectorAll('.nav').forEach(button => {
    button.addEventListener('click', () => openPage(button.dataset.page));
  });
}

function openPage(page) {
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === page));
  const titles = {
    games: ['All Games', 'Browse indexed Roblox games with pagination, creative and monetization proxies.'],
    analyzer: ['Game Analyzer', 'Deep-dive into one game: charts, monetization, creative strength and risks.'],
    monetization: ['Monetization', 'Estimate which games have stronger monetization fit using public-data proxies.'],
    creative: ['Creative Lab', 'Thumbnail and ad creative intelligence using public image and engagement signals.'],
    radar: ['Chance Radar', 'Find market gaps, hidden quality, fast movers and sleeping competitors.'],
    genres: ['Genres', 'Compare genre size, quality, saturation, risk and opportunity.'],
    limiteds: ['Limiteds', 'Analyze RAP, value, demand, trend, deal and risk.'],
    data: ['Data', 'See when GitHub Actions last updated the dataset.']
  };
  const [title, subtitle] = titles[page] || titles.games;
  $('title').textContent = title;
  $('subtitle').textContent = subtitle;
  renderAll();
}

function bindControls() {
  ['search', 'genreFilter', 'sortBy'].forEach(id => $(id)?.addEventListener('input', () => { state.page = 1; renderGames(); }));
  $('perPage')?.addEventListener('input', () => { state.perPage = Number($('perPage').value); state.page = 1; renderGames(); });
  ['limitedSearch', 'limitedSort'].forEach(id => $(id)?.addEventListener('input', renderLimiteds));
  $('detailSearch')?.addEventListener('input', renderDetailSearch);
  $('refreshLocal')?.addEventListener('click', () => location.reload());
}

function filteredGames() {
  const q = $('search')?.value.trim().toLowerCase() || '';
  const genre = $('genreFilter')?.value || '';
  const sort = $('sortBy')?.value || 'players';
  return state.games
    .filter(game => {
      const haystack = `${game.name} ${game.creator} ${game.description} ${game.genre}`.toLowerCase();
      return (!q || haystack.includes(q)) && (!genre || game.genre === genre);
    })
    .sort((a, b) => Number(b[sort] || 0) - Number(a[sort] || 0));
}

function renderGames() {
  if (!$('gamesBody')) return;
  const games = filteredGames();
  const totalPages = Math.max(1, Math.ceil(games.length / state.perPage));
  state.page = Math.max(1, Math.min(state.page, totalPages));
  const start = (state.page - 1) * state.perPage;
  const pageGames = games.slice(start, start + state.perPage);
  $('range').textContent = games.length ? `${fmt(start + 1)}-${fmt(start + pageGames.length)} of ${fmt(games.length)} games` : '0 games';
  $('gamesBody').innerHTML = pageGames.length ? pageGames.map(game => `
    <tr onclick="selectGame('${game.universe_id}', true)">
      <td>${gameCell(game)}</td>
      <td>${fmt(game.players)}</td>
      <td>${compact(game.visits)}</td>
      <td>${pct(game.rating)}</td>
      <td><span class="score money">${score(game.monetization_score)}</span></td>
      <td><span class="score creative">${score(game.thumbnail_score)}</span></td>
      <td><span class="score hot">${score(game.opportunity_score)}</span></td>
      <td><span class="score risk">${score(game.risk_score)}</span></td>
      <td>${shortDate(game.updated)}</td>
    </tr>`).join('') : `<tr><td colspan="9">No games found yet. Run the GitHub Action once.</td></tr>`;
  renderPagination(totalPages);
  renderStats(games);
}

function renderPagination(totalPages) {
  const html = [];
  html.push(`<button ${state.page <= 1 ? 'disabled' : ''} onclick="goPage(${state.page - 1})">Prev</button>`);
  const start = Math.max(1, state.page - 2);
  const end = Math.min(totalPages, state.page + 2);
  if (start > 1) html.push(pageButton(1), `<span>...</span>`);
  for (let p = start; p <= end; p += 1) html.push(pageButton(p));
  if (end < totalPages) html.push(`<span>...</span>`, pageButton(totalPages));
  html.push(`<button ${state.page >= totalPages ? 'disabled' : ''} onclick="goPage(${state.page + 1})">Next</button>`);
  $('paginationTop').innerHTML = html.join('');
  $('paginationBottom').innerHTML = html.join('');
}

function pageButton(page) { return `<button class="${page === state.page ? 'active' : ''}" onclick="goPage(${page})">${page}</button>`; }
window.goPage = page => { state.page = page; renderGames(); };

function renderStats(games) {
  const totalPlayers = games.reduce((sum, g) => sum + Number(g.players || 0), 0);
  const avgRating = games.length ? games.reduce((sum, g) => sum + Number(g.rating || 0), 0) / games.length : 0;
  const marketRobux = games.reduce((sum, g) => sum + mid(g.estimated_robux_day_low, g.estimated_robux_day_high), 0);
  $('totalGames').textContent = fmt(games.length);
  $('totalPlayers').textContent = compact(totalPlayers);
  $('avgRating').textContent = pct(avgRating);
  if ($('marketRobux')) $('marketRobux').textContent = money(marketRobux);
  $('lastUpdate').textContent = shortDate(state.meta.games.updated_at);
}

function buildGenreSelect() {
  const el = $('genreFilter');
  if (!el) return;
  const genres = [...new Set(state.games.map(game => game.genre || 'Unknown'))].sort();
  el.innerHTML = `<option value="">All genres</option>` + genres.map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
}

function selectGame(id, jump = false) {
  state.selected = state.games.find(g => String(g.universe_id) === String(id)) || state.selected;
  renderGameDetail();
  renderDetailSearch();
  if (jump) openPage('analyzer');
}
window.selectGame = selectGame;

function renderGameDetail() {
  const box = $('gameDetail');
  if (!box) return;
  const g = state.selected;
  if (!g) {
    box.innerHTML = `<h2>No game selected</h2><p class="muted">Click any game in All Games, Monetization or Creative Lab.</p>`;
    return;
  }

  const robuxLow = Number(g.estimated_robux_day_low || 0);
  const robuxHigh = Number(g.estimated_robux_day_high || 0);
  const ctrLow = Number(g.thumb_ctr_low || 0);
  const ctrHigh = Number(g.thumb_ctr_high || 0);
  const thumbs = (g.thumbnails && g.thumbnails.length ? g.thumbnails : [g.icon_url]).filter(Boolean);

  box.innerHTML = `
    <div class="detail-top-grid">
      <div class="detail-hero pro">
        ${gameImage(g, 'detail-icon')}
        <div>
          <div class="eyebrow">Universe ${escapeHtml(g.universe_id)}</div>
          <h2>${escapeHtml(g.name)}</h2>
          <p class="muted">${escapeHtml(g.creator || 'Unknown')} · ${escapeHtml(g.genre || 'Unknown')} · Updated ${shortDate(g.updated)}</p>
          <div class="badge-row">
            <span class="score money">Money ${score(g.monetization_score)}</span>
            <span class="score creative">Thumbnail ${score(g.thumbnail_score)}</span>
            <span class="score hot">Opportunity ${score(g.opportunity_score)}</span>
            <span class="score risk">Risk ${score(g.risk_score)}</span>
          </div>
          <div class="detail-actions">
            <a class="button" target="_blank" rel="noreferrer" href="https://www.roblox.com/games/${escapeHtml(g.place_id || '')}">Open Roblox</a>
            <button onclick="copyText('${escapeHtml(String(g.universe_id))}')">Copy Universe ID</button>
            <button onclick="copyText('${escapeHtml(String(g.place_id || ''))}')">Copy Place ID</button>
          </div>
        </div>
      </div>
      <div class="panel-lite">
        <h3>Executive read</h3>
        ${executiveRead(g).map(x => `<div class="signal-line ${x.kind}"><strong>${x.title}</strong><span>${x.text}</span></div>`).join('')}
      </div>
    </div>

    <div class="metric-grid pro-metrics">
      ${metric('Players', compact(g.players), 'Current public CCU')}
      ${metric('Visits', compact(g.visits), 'Total public visits')}
      ${metric('Rating', pct(g.rating), `${fmt(g.up_votes)} up · ${fmt(g.down_votes)} down`)}
      ${metric('Favorites', compact(g.favorites), `${Number(g.favorites_per_1k_visits || 0).toFixed(2)} / 1k visits`)}
      ${metric('Robux/day proxy', `${money(robuxLow)}–${money(robuxHigh)}`, 'Estimated range, not private revenue')}
      ${metric('RPV proxy', `${Number(g.rpv_proxy || 0).toFixed(2)} R$`, 'Robux per estimated session/visit proxy')}
      ${metric('Session estimate', `${Number(g.session_estimate_minutes || 0).toFixed(1)} min`, `${compact(g.estimated_daily_sessions)} sessions/day proxy`)}
      ${metric('CTR proxy range', `${ctrLow.toFixed(1)}–${ctrHigh.toFixed(1)}%`, 'Thumbnail/ad creative proxy')}
    </div>

    <div class="analytics-grid">
      <div class="chart-card wide">
        <div class="chart-title"><h3>Market Performance Projection</h3><span class="muted">model based on current public signals</span></div>
        ${lineChart(projectedSeries(g), 'Players projection')}
      </div>
      <div class="chart-card">
        <div class="chart-title"><h3>Score Radar</h3><span class="muted">0-100 profile</span></div>
        ${radarChart(g)}
      </div>
      <div class="chart-card">
        <div class="chart-title"><h3>Monetization Funnel</h3><span class="muted">conversion proxy</span></div>
        ${funnelChart(g)}
      </div>
      <div class="chart-card">
        <div class="chart-title"><h3>Creative / Ad Fit</h3><span class="muted">thumbnail read</span></div>
        ${barSet([
          ['Title Hook', g.title_hook_score], ['Thumbnail', g.thumbnail_score], ['Ad Fit', g.ad_fit_score], ['Purchase Intent', g.purchase_intent_score]
        ])}
      </div>
      <div class="chart-card wide">
        <div class="chart-title"><h3>Thumbnail Intelligence</h3><span class="muted">which creative likely pulls attention</span></div>
        <div class="thumb-strip pro-thumbs">
          ${thumbs.slice(0, 6).map((src, i) => `<div class="thumb-card"><img src="${escapeHtml(src)}" alt="thumbnail"><div><strong>Creative ${i + 1}</strong><small>CTR proxy ${creativeVariantScore(g, i).toFixed(1)}%</small><div class="mini-bar"><i style="width:${Math.min(100, creativeVariantScore(g, i) * 12)}%"></i></div></div></div>`).join('') || `<div class="muted-box">No public thumbnails found yet. Run the Action again later.</div>`}
        </div>
      </div>
    </div>

    <h2 class="section-title">Intelligence Signals</h2>
    <div class="insight-grid pro-signals">
      ${signalCard('Monetization Fit', moneyText(g), g.monetization_score, 'money')}
      ${signalCard('Creative Strength', creativeText(g), g.thumbnail_score, 'creative')}
      ${signalCard('Market Opportunity', opportunityText(g), g.opportunity_score, 'hot')}
      ${signalCard('Risk / Saturation', riskText(g), g.risk_score, 'risk')}
    </div>

    <div class="panel-lite clone-box">
      <h3>Build Notes for a Competitor Game</h3>
      <ul>
        ${buildNotes(g).map(x => `<li>${x}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderDetailSearch() {
  const el = $('detailResults');
  if (!el) return;
  const q = ($('detailSearch')?.value || '').trim().toLowerCase();
  const games = state.games
    .filter(g => !q || `${g.name} ${g.creator} ${g.genre}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.monetization_score || 0) - Number(a.monetization_score || 0))
    .slice(0, 80);
  el.innerHTML = games.map(g => `<div class="mini-row" onclick="selectGame('${g.universe_id}', false)">${gameImage(g, 'mini-img')}<div><strong>${escapeHtml(g.name)}</strong><small>${compact(g.players)} players · Money ${score(g.monetization_score)} · Thumb ${score(g.thumbnail_score)}</small></div></div>`).join('') || `<p class="muted">No games found.</p>`;
}

function renderMonetization() {
  if (!$('moneyBody')) return;
  const games = [...state.games].sort((a, b) => Number(b.monetization_score || 0) - Number(a.monetization_score || 0));
  const top = games[0];
  $('topMoneyGame').textContent = top ? trimName(top.name, 22) : '-';
  $('avgMoneyScore').textContent = games.length ? (games.reduce((s, g) => s + Number(g.monetization_score || 0), 0) / games.length).toFixed(1) : '0';
  $('bestRpv').textContent = games.length ? `${Number(Math.max(...games.map(g => Number(g.rpv_proxy || 0)))).toFixed(2)} R$` : '0 R$';
  $('highIntent').textContent = fmt(games.filter(g => Number(g.purchase_intent_score || 0) >= 70).length);
  $('moneyBody').innerHTML = games.slice(0, 250).map(g => `<tr onclick="selectGame('${g.universe_id}', true)"><td>${gameCell(g)}</td><td><span class="score money">${score(g.monetization_score)}</span></td><td>${money(g.estimated_robux_day_low)}–${money(g.estimated_robux_day_high)}</td><td>${Number(g.rpv_proxy || 0).toFixed(2)} R$</td><td>${Number(g.session_estimate_minutes || 0).toFixed(1)} min</td><td><span class="score hot">${score(g.purchase_intent_score)}</span></td><td><span class="score creative">${score(g.ad_fit_score)}</span></td></tr>`).join('') || `<tr><td colspan="7">No game data yet.</td></tr>`;
}

function renderCreative() {
  if (!$('creativeGrid')) return;
  const games = [...state.games].sort((a, b) => Number(b.thumbnail_score || 0) - Number(a.thumbnail_score || 0));
  const top = games[0];
  $('bestThumbGame').textContent = top ? trimName(top.name, 22) : '-';
  $('avgThumbScore').textContent = games.length ? (games.reduce((s, g) => s + Number(g.thumbnail_score || 0), 0) / games.length).toFixed(1) : '0';
  $('adReadyCount').textContent = fmt(games.filter(g => Number(g.ad_fit_score || 0) >= 70).length);
  $('thumbCount').textContent = fmt(games.reduce((s, g) => s + ((g.thumbnails || []).length), 0));
  $('creativeGrid').innerHTML = games.slice(0, 60).map(g => {
    const img = (g.thumbnails && g.thumbnails[0]) || g.icon_url || '';
    return `<div class="creative-card" onclick="selectGame('${g.universe_id}', true)">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(g.name)}">` : `<div class="thumb-fallback">RT</div>`}
      <div class="content"><strong>${escapeHtml(g.name)}</strong><small>${compact(g.players)} players · ${escapeHtml(g.genre)}</small><div class="badge-row"><span class="score creative">Thumb ${score(g.thumbnail_score)}</span><span class="score hot">Ad ${score(g.ad_fit_score)}</span><span class="score">CTR ${Number(g.thumb_ctr_low || 0).toFixed(1)}-${Number(g.thumb_ctr_high || 0).toFixed(1)}%</span></div></div>
    </div>`;
  }).join('') || `<p class="muted">No creative data yet.</p>`;
}

function renderGenres() {
  if (!$('genreCards')) return;
  const map = new Map();
  for (const game of state.games) {
    const key = game.genre || 'Unknown';
    if (!map.has(key)) map.set(key, { genre: key, games: 0, players: 0, quality: 0, opportunity: 0, risk: 0, money: 0, thumb: 0 });
    const row = map.get(key);
    row.games += 1; row.players += Number(game.players || 0); row.quality += Number(game.quality_score || 0); row.opportunity += Number(game.opportunity_score || 0); row.risk += Number(game.risk_score || 0); row.money += Number(game.monetization_score || 0); row.thumb += Number(game.thumbnail_score || 0);
  }
  const genres = [...map.values()].map(g => ({ ...g, quality: g.quality/g.games, opportunity: g.opportunity/g.games, risk: g.risk/g.games, money: g.money/g.games, thumb: g.thumb/g.games })).sort((a,b)=>b.players-a.players);
  $('genreCards').innerHTML = genres.map(g => `<article class="card"><strong>${escapeHtml(g.genre)}</strong><span>${fmt(g.games)} games · ${compact(g.players)} players</span><div class="bar"><i style="width:${Math.min(100,g.opportunity)}%"></i></div><small>Quality ${g.quality.toFixed(1)} · Money ${g.money.toFixed(1)} · Thumb ${g.thumb.toFixed(1)} · Risk ${g.risk.toFixed(1)}</small></article>`).join('');
}

function renderRadar() {
  if (!$('radarGrid')) return;
  const sections = [
    ['Hidden Quality', state.games.filter(g => Number(g.quality_score) >= 65 && Number(g.players) < 1500).sort((a,b)=>b.opportunity_score-a.opportunity_score)],
    ['Ad Creative Winners', [...state.games].sort((a,b)=>b.thumbnail_score-a.thumbnail_score)],
    ['Money Candidates', [...state.games].sort((a,b)=>b.monetization_score-a.monetization_score)]
  ];
  $('radarGrid').innerHTML = sections.map(([title, games]) => `<article class="card"><h2>${title}</h2><div class="radar-list">${games.slice(0,14).map(g => `<div class="radar-row" onclick="selectGame('${g.universe_id}', true)"><span>${escapeHtml(g.name)}</span><strong>${title.includes('Money') ? score(g.monetization_score) : title.includes('Creative') ? score(g.thumbnail_score) : score(g.opportunity_score)}</strong></div>`).join('') || `<p class="muted">No data yet.</p>`}</div></article>`).join('');
}

function renderLimiteds() {
  if (!$('limitedBody')) return;
  const q = $('limitedSearch')?.value.trim().toLowerCase() || '';
  const sort = $('limitedSort')?.value || 'deal_score';
  const items = state.limiteds.filter(item => `${item.name} ${item.acronym} ${item.item_id}`.toLowerCase().includes(q)).sort((a,b)=>Number(b[sort]||0)-Number(a[sort]||0)).slice(0,300);
  $('limitedBody').innerHTML = items.length ? items.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.acronym || '')} · ${item.item_id}</small></td><td>${fmt(item.rap)}</td><td>${fmt(item.value || item.rap)}</td><td>${item.demand}</td><td>${item.trend}</td><td><span class="score hot">${score(item.deal_score)}</span></td><td><span class="score risk">${score(item.risk_score)}</span></td><td>${flags(item)}</td></tr>`).join('') : `<tr><td colspan="8">No limited data yet. Run the GitHub Action once.</td></tr>`;
}

function renderData() {
  if (!$('dataStatus')) return;
  $('dataStatus').textContent = JSON.stringify({ games: state.meta.games, limiteds: state.meta.limiteds, loaded_games: state.games.length, loaded_limiteds: state.limiteds.length, selected_game: state.selected?.name || null }, null, 2);
}

function renderAll() { renderGames(); renderGameDetail(); renderDetailSearch(); renderMonetization(); renderCreative(); renderGenres(); renderRadar(); renderLimiteds(); renderData(); }

function gameCell(game) { return `<div class="game-cell">${gameImage(game, '')}<div><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.creator || 'Unknown')} · ${escapeHtml(game.genre || 'Unknown')}</small></div></div>`; }
function gameImage(game, cls='') { return game.icon_url ? `<img class="${cls}" src="${escapeHtml(game.icon_url)}" alt="${escapeHtml(game.name)}" onerror="this.outerHTML='<span class=&quot;fallback ${cls}&quot;>RT</span>'">` : `<span class="fallback ${cls}">RT</span>`; }
function metric(label, value, sub) { return `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${sub || ''}</small></div>`; }
function signalCard(title, text, value, klass) { return `<div class="insight"><div class="signal-head"><strong>${title}</strong><span class="score ${klass}">${score(value)}</span></div><p>${text}</p><div class="mini-bar"><i style="width:${Math.min(100, Number(value || 0))}%"></i></div></div>`; }

function lineChart(values, label) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => {
    const x = 20 + i * (560 / Math.max(values.length - 1, 1));
    const y = 210 - ((v - min) / Math.max(max - min, 1)) * 170;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="line-chart" viewBox="0 0 620 245" role="img" aria-label="${label}">
    <defs><linearGradient id="lineGrad" x1="0" x2="1"><stop stop-color="#4f8cff"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>
    ${[0,1,2,3].map(i => `<line x1="20" x2="590" y1="${40+i*48}" y2="${40+i*48}"/>`).join('')}
    <polyline points="${pts}" fill="none" stroke="url(#lineGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    ${values.map((v,i)=>{const [x,y]=pts.split(' ')[i].split(',');return `<circle cx="${x}" cy="${y}" r="5"/>`;}).join('')}
    <text x="20" y="232">Now</text><text x="535" y="232">7d model</text><text x="20" y="28">${compact(max)}</text><text x="20" y="215">${compact(min)}</text>
  </svg>`;
}

function radarChart(g) {
  const labels = [
    ['Money', g.monetization_score], ['Creative', g.thumbnail_score], ['Opportunity', g.opportunity_score], ['Quality', g.quality_score], ['Trend', g.trending_score], ['Safety', 100 - Number(g.risk_score || 0)]
  ];
  const cx = 140, cy = 125, r = 86;
  const axis = labels.map((_, i) => point(cx, cy, r, i, labels.length));
  const poly = labels.map(([_, v], i) => point(cx, cy, r * Math.max(0, Math.min(100, Number(v || 0))) / 100, i, labels.length).join(',')).join(' ');
  return `<svg class="radar-chart" viewBox="0 0 280 260">
    ${[.33,.66,1].map(k => `<polygon points="${labels.map((_,i)=>point(cx,cy,r*k,i,labels.length).join(',')).join(' ')}"/>`).join('')}
    ${axis.map(p => `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}"/>`).join('')}
    <polygon class="radar-fill" points="${poly}"/>
    ${labels.map(([name,v],i)=>{const p=point(cx,cy,r+22,i,labels.length);return `<text x="${p[0]}" y="${p[1]}">${name} ${score(v)}</text>`}).join('')}
  </svg>`;
}
function point(cx,cy,r,i,total){const a=-Math.PI/2+i*2*Math.PI/total;return [+(cx+Math.cos(a)*r).toFixed(1), +(cy+Math.sin(a)*r).toFixed(1)];}

function funnelChart(g) {
  const sessions = Number(g.estimated_daily_sessions || 0);
  const lowPayers = sessions * (0.0015 + Number(g.monetization_score || 0)/100 * 0.004);
  const highPayers = sessions * (0.004 + Number(g.monetization_score || 0)/100 * 0.014);
  const avgRobux = mid(g.estimated_robux_day_low, g.estimated_robux_day_high);
  const rows = [
    ['Daily sessions', sessions, 100],
    ['Low payer proxy', lowPayers, 62],
    ['High payer proxy', highPayers, 45],
    ['Robux/day avg', avgRobux, 78]
  ];
  return `<div class="funnel">${rows.map(([name,val,w])=>`<div class="funnel-row"><span>${name}</span><strong>${compact(val)}</strong><div><i style="width:${w}%"></i></div></div>`).join('')}</div>`;
}

function barSet(rows) { return `<div class="bar-set">${rows.map(([name,val]) => `<div class="bar-row"><span>${name}</span><strong>${score(val)}</strong><div class="mini-bar"><i style="width:${Math.min(100, Number(val || 0))}%"></i></div></div>`).join('')}</div>`; }
function projectedSeries(g) { const base = Number(g.players || 0); const momentum = (Number(g.trending_score || 0) - Number(g.risk_score || 0) * .35 + Number(g.opportunity_score || 0) * .2) / 1000; return Array.from({length:8},(_,i)=>Math.max(0, base * (1 + momentum * i) + Math.sin(i * 1.25) * base * .035)); }
function creativeVariantScore(g, i) { return Math.max(Number(g.thumb_ctr_low || 0), Math.min(Number(g.thumb_ctr_high || 0), Number(g.thumb_ctr_low || 0) + (Number(g.thumb_ctr_high || 0) - Number(g.thumb_ctr_low || 0)) * (0.38 + i * .09))); }

function executiveRead(g) {
  return [
    { kind: Number(g.monetization_score || 0) >= 70 ? 'good' : 'mid', title: 'Monetization', text: Number(g.monetization_score || 0) >= 70 ? 'Strong economy/purchase fit based on public signals.' : 'Monetization fit is moderate; needs stronger progression or offers.' },
    { kind: Number(g.thumbnail_score || 0) >= 70 ? 'good' : 'mid', title: 'Creative', text: Number(g.thumbnail_score || 0) >= 70 ? 'Likely strong ad/thumbnail hook.' : 'Creative hook could be improved for ads.' },
    { kind: Number(g.risk_score || 0) >= 60 ? 'bad' : 'good', title: 'Risk', text: Number(g.risk_score || 0) >= 60 ? 'High saturation or quality risk. Copy carefully.' : 'Risk profile is manageable.' }
  ];
}
function moneyText(g){return `Estimated monetization fit is ${score(g.monetization_score)}/100 with a daily Robux proxy around ${money(mid(g.estimated_robux_day_low,g.estimated_robux_day_high))}. Use this as a market signal, not exact revenue.`;}
function creativeText(g){return `Thumbnail score ${score(g.thumbnail_score)}/100 and CTR proxy ${Number(g.thumb_ctr_low||0).toFixed(1)}-${Number(g.thumb_ctr_high||0).toFixed(1)}%. Better title clarity, character emotion and contrast can lift this.`;}
function opportunityText(g){return `Opportunity score ${score(g.opportunity_score)}/100. High values mean the game looks good relative to its current visibility and saturation.`;}
function riskText(g){return `Risk score ${score(g.risk_score)}/100. Higher risk usually means saturation, weak rating, or harder competition.`;}
function buildNotes(g){const notes=[];if(Number(g.thumbnail_score||0)>=70)notes.push('Study the thumbnail composition: strong hook, readable title, simple subject, high contrast.');else notes.push('Opportunity: make a cleaner, more readable thumbnail than this niche usually has.');if(Number(g.monetization_score||0)>=70)notes.push('The niche likely supports gamepasses/devproducts. Build progression, boosts, skip timers and cosmetics early.');else notes.push('Monetization may need careful design: add light progression and non-pay-to-win cosmetic value.');if(Number(g.risk_score||0)>=55)notes.push('Do not hard-clone: add a unique mechanic, stronger onboarding and better update cadence.');else notes.push('Competition risk looks manageable; speed and polish could matter more than massive innovation.');notes.push(`Ad angle: lead with the clearest hook in the title: ${escapeHtml(g.name.split('|')[0].slice(0,42))}.`);return notes;}

function flags(item) { const out=[]; if(item.projected) out.push('Projected'); if(item.hyped) out.push('Hyped'); if(item.rare) out.push('Rare'); return out.map(flag=>`<span class="pill">${flag}</span>`).join(' ') || '-'; }
function score(v) { return Number(v || 0).toFixed(0); }
function mid(a,b) { a = Number(a || 0); b = Number(b || 0); return (a + b) / 2; }
function trimName(name, len) { name = String(name || '-'); return name.length > len ? name.slice(0, len - 1) + '…' : name; }
function shortDate(value) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value).slice(0,10) : date.toLocaleDateString(); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
window.copyText = text => navigator.clipboard?.writeText(text);

boot();