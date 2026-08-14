# Geeked-Dashboard einrichten

Diese Anleitung richtet das Dashboard mit kostenlosen Angeboten ein:

- **GitHub Pages:** öffentliche Website;
- **Cloudflare Worker:** sichere API und Discord-Login;
- **Cloudflare D1:** nur Konfiguration, kurze Sitzungen und Änderungsprotokoll;
- **Wispbyte:** weiterhin der eigentliche Discord-Bot.

Die GitHub-Seite enthält **keinen** Bot-Token, kein Discord-Client-Secret und
keinen Sync-Key. Ein veränderter Browser-Client kann deshalb nicht direkt auf
den Bot zugreifen.

## Was du vorher brauchst

1. deinen GitHub-Account;
2. einen kostenlosen Cloudflare-Account;
3. Zugriff auf die vorhandene Discord-Anwendung von Geeked;
4. Zugriff auf die Wispbyte-Dateien und Environment-Variablen;
5. Node.js auf deinem PC für die einmalige Worker-Bereitstellung.

## 1. GitHub-Seite vorbereiten

1. Erstelle auf GitHub ein **öffentliches** Repository namens
   `geeked-dashboard`.
2. Deine spätere Adresse lautet normalerweise:

   ```text
   https://DEIN_GITHUB_NAME.github.io/geeked-dashboard/
   ```

3. Entpacke `Geeked-GitHub-Pages-v1.zip` auf deinem PC.
4. Öffne zunächst `config.js`. Die Worker-Adresse wird in Schritt 5
   eingetragen. Lade die Seite noch nicht endgültig hoch.

Im GitHub-Repository dürfen später genau diese Dateien öffentlich liegen:

```text
.nojekyll
app.js
config.js
index.html
styles.css
```

## 2. Cloudflare-D1-Datenbank erstellen

Entpacke `Geeked-Cloudflare-Worker-v1.zip`, öffne ein Terminal in diesem Ordner
und führe aus:

```powershell
npm install
npx wrangler login
npx wrangler d1 create geeked-dashboard
```

Cloudflare gibt eine `database_id` aus. Kopiere anschließend
`wrangler.jsonc.example` zu `wrangler.jsonc` und ersetze dort:

- `PASTE_D1_DATABASE_ID` durch die ausgegebene D1-ID;
- `PASTE_DISCORD_CLIENT_ID` durch die Client-ID deiner Discord-Anwendung;
- `YOUR_GITHUB_USERNAME` durch deinen GitHub-Namen;
- bei Bedarf `OWNER_USER_ID` durch deine Discord-User-ID.

Die Geeked-Server-ID und deine acht Staff-Rollen sind bereits eingetragen.

Erstelle danach die Tabellen:

```powershell
npx wrangler d1 execute geeked-dashboard --remote --file=./schema.sql
```

## 3. Zwei geheime Schlüssel erzeugen

Führe im Worker-Ordner aus:

```powershell
node scripts/generate-secrets.cjs
```

Du erhältst:

```text
BOT_SYNC_TOKEN=...
SESSION_PEPPER=...
```

Speichere beide Werte vorübergehend an einem sicheren Ort. Lade sie niemals zu
GitHub hoch und sende sie niemandem.

## 4. Cloudflare-Secrets eintragen

Öffne in Discord das **Developer Portal → deine Anwendung → OAuth2**. Kopiere
oder erneuere dort das Client-Secret. Trage anschließend alle drei Secrets über
das Terminal ein:

```powershell
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put BOT_SYNC_TOKEN
npx wrangler secret put SESSION_PEPPER
```

Wrangler fragt nach jedem Befehl nach dem entsprechenden Wert. Beim Einfügen
wird der Wert nicht in den Quellcode geschrieben.

## 5. Worker bereitstellen

Führe aus:

```powershell
npx wrangler deploy
```

Am Ende erscheint eine Adresse ähnlich wie:

```text
https://geeked-dashboard-api.DEIN_SUBDOMAIN.workers.dev
```

Öffne `wrangler.jsonc` noch einmal und setze `PUBLIC_API_ORIGIN` exakt auf diese
Adresse. Führe danach erneut aus:

```powershell
npx wrangler deploy
```

Teste anschließend:

```text
https://geeked-dashboard-api.DEIN_SUBDOMAIN.workers.dev/health
```

Es sollte eine Antwort mit `"ok":true` erscheinen.

## 6. Discord-OAuth2-Weiterleitung eintragen

Öffne im Discord Developer Portal:

```text
OAuth2 → Redirects
```

Füge exakt diese Adresse hinzu:

```text
https://geeked-dashboard-api.DEIN_SUBDOMAIN.workers.dev/auth/callback
```

Speichere die Änderung. Das ist nur der Dashboard-Login und benötigt keinen
zusätzlichen privilegierten Gateway Intent.

## 7. GitHub Pages online stellen

Trage in der öffentlichen `config.js` nur deine Worker-Adresse ein:

```js
window.GEEKED_DASHBOARD_CONFIG = Object.freeze({
  apiBaseUrl: "https://geeked-dashboard-api.DEIN_SUBDOMAIN.workers.dev",
});
```

Lade die fünf Dateien aus dem GitHub-Pages-ZIP in die oberste Ebene des
Repositories hoch. Öffne dann auf GitHub:

```text
Settings → Pages → Build and deployment
```

Wähle:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Nach kurzer Zeit ist die Seite unter deiner GitHub-Pages-Adresse erreichbar.

## 8. Wispbyte-Bot verbinden

Lade `Geeked-Wispbyte-Bot-v3.zip` bei Wispbyte hoch und überschreibe die alten
Bot-Dateien. Behalte deine vorhandene `.env` und ergänze:

```env
DASHBOARD_ENABLED=true
DASHBOARD_API_URL=https://geeked-dashboard-api.DEIN_SUBDOMAIN.workers.dev
DASHBOARD_SYNC_TOKEN=HIER_DERSELBE_BOT_SYNC_TOKEN_WIE_BEI_CLOUDFLARE
DASHBOARD_SYNC_SECONDS=60
```

Der `DASHBOARD_SYNC_TOKEN` muss bei Cloudflare und Wispbyte exakt gleich sein.
Der `SESSION_PEPPER` und das Discord-Client-Secret gehören **nur** zu
Cloudflare. Der Discord-Bot-Token gehört **nur** zu Wispbyte.

Starte den Bot anschließend neu. In der Konsole sollte stehen:

```text
[DASHBOARD] Sync enabled; checking every 60 seconds.
```

## 9. Erster Login und erste Speicherung

1. Öffne deine GitHub-Pages-Adresse.
2. Klicke auf `Continue with Discord`.
3. Discord prüft, ob du eine fest hinterlegte Geeked-Staffrolle hast.
4. Bearbeite die Einstellungen und speichere sie.
5. Der Bot prüft deine aktuelle Rolle selbst noch einmal und übernimmt die
   neue Revision innerhalb von ungefähr 60 Sekunden.

Bei `Keep Wispbyte setting` bleiben deine bisherigen `.env`-Werte aktiv. Leere
Kanal- oder AutoJail-Rollenfelder übernehmen ebenfalls den bisherigen
Wispbyte-Wert. So verändert die erste Speicherung nicht versehentlich dein
laufendes Jail-System.

## Sicherheitsregeln

- Niemals Bot-Token, Client-Secret, Sync-Token oder Session-Pepper in GitHub
  eintragen.
- Keine `.env`, `.dev.vars` oder echte `wrangler.jsonc` öffentlich hochladen.
- Falls ein Secret versehentlich sichtbar wird, sofort erneuern.
- Die feste Staff-Whitelist nur gleichzeitig in Wispbyte und Cloudflare ändern.
- Der Bot braucht weiterhin nur `Guilds` und `GuildModeration`; alle drei
  privilegierten Gateway Intents bleiben deaktiviert.

## Welche Daten D1 speichert

- die aktuellen Bot-Einstellungen;
- Revisionsnummer, Änderungszeit und Discord-User-ID des Bearbeiters;
- eine kurzlebige 30-Minuten-Sitzung mit User-ID, Benutzername und Staffrollen.

D1 speichert keine Booster-Liste, keine persönlichen Booster-Rollen, keine
hochgeladenen Rollenbilder und keinen Nachrichteninhalt. Abgelaufene Sitzungen
werden automatisch entfernt. Der öffentliche Login nutzt einen signierten,
zustandslosen Sicherheitswert und verbraucht dadurch keine D1-Schreibvorgänge.
