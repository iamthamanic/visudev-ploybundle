# App Flow – Fixes testen

So prüfst du die Änderungen (Kanten von Buttons, Modal-Platzhalter, Login).

---

## 1. Voraussetzung

- **VisuDEV starten** (im Projektordner):

  ```bash
  npm run dev
  ```

  Das startet die App auf **http://localhost:3005** und den Preview-Runner auf **http://localhost:4000**.

- **Projekt mit Repo:** Ein Projekt anlegen/auswählen und GitHub-Repo verbinden (falls noch nicht geschehen).

---

## 2. App Flow öffnen und Analyse/Preview

1. In der **Sidebar** auf **App Flow** klicken.
2. Wenn noch keine Screens da sind: **„Neu analysieren“** (oder Analyse über Blueprint/Data) ausführen, bis Screens und Flows erscheinen.
3. **„Preview starten“** klicken (bei Sitemap oder in der App-Flow-Ansicht). Warten, bis eine Preview-URL angezeigt wird (z. B. `http://localhost:4001`).
4. Die Karten laden nun die Live-App in Iframes. In der Toolbar siehst du z. B. **„Screens: 5/7 (71 %)“** – je nachdem, wie viele Iframes erfolgreich geladen werden.

---

## 3. Was du prüfen solltest

### Kanten starten an den Buttons (nicht am Kartenrand)

- **Erwartung:** Von der **Projekte-/Shell-Karte** (Startseite mit Sidebar) gehen Linien zu den anderen Screens (App Flow, Blueprint, Data, Logs, Settings). Die Linien **starten an der Position der Sidebar-Tabs** („App Flow“, „Blueprint“ usw.), nicht am rechten Kartenrand.
- **So prüfen:** Projekte-Karte im Fokus – die Kante zu „App Flow“ sollte links an der Höhe des Tabs „App Flow“ beginnen. Wenn die Shell im Iframe geladen ist und `visudev-dom-report` sendet, nutzt der Fix den Fallback-Report dafür.
- **Wenn alle Linien noch am Rand starten:** In der Toolbar erscheint der Hinweis **„Linien am Kartenrand – Tab-Positionen nicht empfangen“**. Dann: DevTools (F12) → Console. Beim Laden einer Shell-Karte sollte `[VisuDEV dom-report]` mit `navItemsCount > 0` erscheinen. Wenn nicht, läuft die Shell nicht im Iframe oder sendet keinen Report. Die App speichert Tab-Positionen jetzt auch unter einem Fallback, sobald **irgendein** Iframe mit Shell-Inhalt den Report sendet (z. B. auch Modals, die dieselbe URL laden).

### Modal-Inhalte (Modal0, Modal1 nicht leer)

- **Erwartung:** Karten vom Typ **Modal/Tab/Dropdown** zeigen auch ohne Screenshot einen **lesbaren Inhalt**: Icon, Typ-Label („Modal“/„Tab“/„Dropdown“), **Name** des Screens (z. B. „Modal0“) und optional den **State-Key** (falls vorhanden und vom Namen verschieden).
- **So prüfen:** Im Graphen die Karten mit Typ Modal/Tab/Dropdown ansehen. Statt nur Icon + „Modal“ solltest du den **Namen** und ggf. **State-Key** sehen.

### Login-Screen

- **Erwartung:** Wenn die **analysierte App** eine Route `/login` hat, erscheint ein **Login-Screen** im Graphen (als eigene Karte). Er kann „loaded“ oder „failed“ sein (z. B. wenn die Preview bei `/login` weiterleitet).
- **So prüfen:** Nach der Analyse in der Kopfzeile prüfen (z. B. „X Screens“). Wenn Login dabei ist, erscheint eine Login-Karte; bei Redirect/Auth kann sie mit Fehlerhinweis angezeigt werden. Wenn kein Login-Screen vorkommt, hat das Analyserepo vermutlich keine erkennbare `/login`-Route.

---

## 4. Kurz-Checkliste

| Test            | Aktion                                             | Erwartung                                                                        |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Kanten von Tabs | App Flow → Preview läuft → Projekte-Karte sichtbar | Linien starten an Tab-Position („App Flow“, „Blueprint“ …), nicht rechts am Rand |
| Modal-Inhalt    | Modal-/Tab-/Dropdown-Karten ansehen                | Name + ggf. State-Key sichtbar, Karte nicht leer                                 |
| Login           | Projekt mit Login-Route analysieren                | Login erscheint als Screen; Karte ggf. mit Fehlerstatus, wenn Iframe nicht lädt  |

---

## 5. Häufige Probleme

- **„Basis-URL fehlt“ / keine Iframes:** Preview starten („Preview starten“), bis eine URL angezeigt wird. Runner muss laufen (`npm run dev`).
- **Kanten starten immer am Rand:** Console auf `[VisuDEV dom-report]` prüfen. Nur wenn die **Shell** (Projekte-Seite mit Sidebar) in einem der Iframes läuft und die Message sendet, werden Tab-Positionen genutzt.
- **Nur wenige Screens (z. B. 5/7):** Zwei Screens laden nicht (Timeout/Redirect). Deren Karten bleiben sichtbar, zeigen aber Fehlertext. Logs („Lade-Log“ in der UI) zeigen den Grund.
