# Geeked Bot v4.0 auf Wispbyte aktualisieren

## Was sich ändert

- erfolgreiche Jail-Logs verwenden jetzt Components v2;
- `/security status` prüft Berechtigungen, Rollen-Hierarchie und Log-Kanal;
- `/security test-log` sendet einen echten Test-Log;
- `/security check`, `/security jail` und `/security unjail` sind nur für die
  vorhandene Staff-Rollen-Whitelist und den Server-Owner nutzbar;
- eine eindeutig erkannte persönliche Booster-Rolle wird automatisch gelöscht,
  sobald der Besitzer nicht mehr boostet oder den Server verlassen hat.
- Reaction-Role-Panels können im Dashboard als Buttons, Dropdown oder Emoji-
  Reactions erstellt werden; Single- und Multi-Role-Modus sind auswählbar;
- `/reaction-role sync` veröffentlicht alle Panels sofort und
  `/reaction-role status` zeigt deren Zustand. Beide Befehle sind staff-only.

Der Cleanup kann nur Rollen zwischen `Geeked | Booster Roles` und
`Geeked | Booster Roles End` löschen. Normale Serverrollen, Staff-Rollen,
AutoJail-Rollen und die beiden Marker sind davon ausgeschlossen.

## Update durchführen

1. Wispbyte-Server stoppen.
2. Die vorhandene `.env` sichern. Sie enthält deinen Bot-Token und darf nicht
   öffentlich hochgeladen oder gelöscht werden.
3. Das Update-ZIP in `/home/container` hochladen und dort entpacken. Vorhandene
   Dateien mit gleichem Namen ersetzen. Das ZIP enthält nur `.env.example` und
   überschreibt deine echte `.env` nicht.
4. Diese Startup-Zeile weiterverwenden:

   ```bash
   cd /home/container || exit 1; /usr/local/bin/npm install --omit=dev; exec /usr/local/bin/node /home/container/src/start.js
   ```

5. In `.env` muss `LOG_CHANNEL_ID` auf einen Textkanal zeigen, in dem der Bot
   `Kanal ansehen` und `Nachrichten senden` darf. Die bestehenden Booster- und
   Dashboard-Werte bleiben unverändert.
6. In Discord unter **Servereinstellungen → Rollen** die Bot-Rolle über diese
   Rollen ziehen:

   - AutoJail-Trigger-Rolle;
   - Jail-Rolle;
   - `Geeked | Booster Roles`;
   - alle persönlichen Booster-Rollen;
   - `Geeked | Booster Roles End`.

7. Server starten. Der Bot registriert die Commands automatisch neu.

Für das Update empfiehlt sich bei Wispbyte die aktuelle **Node.js 20 LTS**
Runtime. Reaction-Role-Buttons und Dropdowns brauchen `Rollen verwalten`,
`Kanal ansehen` und `Nachrichten senden`. Emoji-Reactions brauchen im
Zielkanal zusätzlich `Nachrichtenverlauf anzeigen`, `Reaktionen hinzufügen`
und `Nachrichten verwalten`. Privilegierte Gateway Intents bleiben aus.

## Direkt danach testen

Führe diese Befehle mit einer deiner freigeschalteten Staff-Rollen aus:

```text
/security status
/security test-log
```

Bei `status` sollte jede Zeile `PASS` anzeigen. Danach in einem kleinen
Testserver oder mit einem Testnutzer:

```text
/security check member:@Testnutzer
/security jail member:@Testnutzer reason:Security test
/security unjail member:@Testnutzer reason:Security test complete
```

Beim Unjail werden nur Trigger- und Jail-Rolle entfernt. Frühere Rollen werden
nicht gespeichert und deshalb nicht automatisch wiederhergestellt.

## Booster-Cleanup testen

Der Besitzer muss seine Custom-Rolle zuerst über das Booster-Panel erstellt
haben. Nach dem Ende des Boosts prüft der Bot den Nutzer spätestens beim
nächsten Intervall aus `BOOSTER_CHECK_INTERVAL_MINUTES` und löscht ausschließlich
diese Rolle. Der Booster-Log zeigt anschließend das Ergebnis.

Weil bewusst keine externe Zuordnungs-Datenbank verwendet wird, rekonstruiert
der Bot Besitzer nach einem Neustart bestmöglich aus Discords Audit-Log. Sehr
alte Rollen außerhalb der abrufbaren Audit-Log-Historie können nicht sicher
zugeordnet und daher nicht automatisch gelöscht werden; dafür bleibt
`/booster-cleanup` verfügbar.
