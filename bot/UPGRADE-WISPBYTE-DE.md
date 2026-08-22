# Bot v5 Multi-Server auf Wispbyte aktualisieren

Version 5 kann gleichzeitig auf mehreren Discord-Servern laufen. Einstellungen,
Staff-Rollen, Logs, Booster-System und Reaction-Role-Panels sind pro Server
getrennt. Nur der globale Bot-Status bleibt fest mit Geeked verbunden.

## 1. Dateien ersetzen

Server stoppen, das v5-ZIP entpacken und diese Dateien/Ordner überschreiben:

- `src/` komplett;
- `index.js`;
- `package.json`;
- `package-lock.json`;
- `.env.example` nur als Vorlage.

Deine echte `.env` nicht löschen und keinen Bot-Token in GitHub hochladen.

## 2. `.env` ergänzen

Deine bisherige `GUILD_ID` bleibt als Geeked-Fallback erhalten. Ergänze:

```env
STATUS_GUILD_ID=1369565242371342446
STATUS_ENABLED=true
STATUS_SERVER_NAME=Geeked
DASHBOARD_ENABLED=true
```

`DASHBOARD_API_URL`, `DASHBOARD_SYNC_TOKEN` und die restlichen vorhandenen Werte
bleiben unverändert. Neue Server brauchen keine eigenen Wispbyte-Variablen; sie
werden im Dashboard konfiguriert.

## 3. Cloudflare Worker ersetzen

Den Inhalt von `dashboard/worker/src/index.js` in den Worker kopieren und neu
deployen. Die vorhandene D1-Datenbank und das vorhandene Schema können bleiben.

Unter Variables and Secrets müssen weiterhin vorhanden sein:

- `DISCORD_CLIENT_ID` als Text;
- `DISCORD_CLIENT_SECRET` als Secret;
- `FRONTEND_URL` als Text;
- `PUBLIC_API_ORIGIN` als Text;
- `BOT_SYNC_TOKEN` als Secret;
- `SESSION_PEPPER` als Secret.

Zusätzlich als Text setzen:

```text
STATUS_GUILD_ID = 1369565242371342446
```

`DISCORD_GUILD_ID` kann vorerst bleiben und wird als alter Status-Fallback
akzeptiert. `STAFF_ROLE_IDS` wird nach der Migration nicht mehr benötigt, weil
jeder Server seine Staff-Rollen selbst im Dashboard speichert.

## 4. GitHub Pages aktualisieren

Die Dateien aus `dashboard/github-pages/` nach `docs/` im Repository kopieren.
Danach die Seite mit `Strg+F5` neu laden und neu bei Discord anmelden. Alte
v4-Sessions werden absichtlich nicht als Multi-Server-Owner-Session akzeptiert.

Oben erscheint nun eine Serverauswahl. Discord zeigt dort nur Server an, die
deinem eingeloggten Account gehören.

## 5. Discord OAuth prüfen

Im Developer Portal unter OAuth2 muss diese Redirect-URL stehen:

```text
https://geeked-dashboard-api.dashflyflash.workers.dev/auth/callback
```

Der Login fordert `identify` und `guilds` an. Es ist keine neue privilegierte
Gateway-Intent-Bewerbung nötig.

## 6. Wispbyte starten

Empfohlene Runtime: Node.js 22. Startup:

```sh
cd /home/container || exit 1; /usr/local/bin/npm install --omit=dev; exec /usr/local/bin/node /home/container/src/start.js
```

Im Log sollte stehen:

```text
[READY] ... in N server(s).
[GUILD:...] Runtime ready ...
[DASHBOARD] Multi-server sync enabled ...
```

## 7. Neuen Server einrichten

1. Bot mit den bisherigen Bot- und Application-Commands-Scopes hinzufügen.
2. Dashboard öffnen und den neuen Server oben auswählen.
3. Staff-Rollen, AutoJail, Booster-System und Reaction Roles für diesen Server
   einstellen.
4. Speichern und höchstens 60 Sekunden warten.
5. `/security status` und `/reaction-role status` testen.

Neue Server starten sicher mit deaktivierten Modulen. Der Bot legt dort keine
Booster-Rollen an, bis der Besitzer das Modul bewusst aktiviert.

## Sicherheit

- Website-Zugriff: nur der jeweilige Serverbesitzer.
- Staff-Befehle: Besitzer plus die pro Server gespeicherten Rollen.
- Daten: eine D1-Zeile pro `guild_id`.
- Reaction-Role-State: eine eigene JSON-Datei pro Server.
- Bot-Status: ausschließlich `STATUS_GUILD_ID` (Geeked).
