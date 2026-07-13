# RoTrends Static Analytics

Roblox trends dashboard for GitHub Pages or Netlify.

## Live hosting

### GitHub Pages
1. Go to **Settings** → **Pages**.
2. Source: **Deploy from a branch**.
3. Branch: `main`.
4. Folder: `/docs`.
5. Save.

Your site will open at:

```txt
https://synt4ix.github.io/Something/
```

### Netlify
1. Import this GitHub repo.
2. Build command: leave empty.
3. Publish directory: `docs`.
4. Deploy.

## Update data

Open **Actions** → **Update Pages Data** → **Run workflow**.

The workflow writes:

```txt
docs/data/games.json
docs/data/limiteds.json
```

No Roblox cookie is used. Never add `.ROBLOSECURITY`.
