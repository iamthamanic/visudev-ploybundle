# VisuDEV-Markup-Konvention (optional)

Kurze Definition optionaler Datenattribute, damit Screens, Modals, Tabs und Trigger von VisuDEV **eindeutig** erkannt und benannt werden können – **ohne** bestehende Logik zu ersetzen oder Code unsicher zu machen.

---

## Grundsätze

- **Additiv:** Alle Attribute sind **optional**. Fehlen sie, arbeitet der Analyzer wie bisher mit Heuristiken (Dateistruktur, Komponentennamen, ARIA).
- **Sicher:** In den Attributen stehen **keine** Secrets, keine user-spezifischen Daten, keine URLs mit Tokens. Nur lesbare Bezeichner (IDs, Labels, Typen).
- **Rückwärtskompatibel:** Bestehender Code bleibt gültig und funktionsfähig. Die Konvention kann schrittweise übernommen werden.

---

## Attribut-Namenraum: `data-visudev-*`

Alle Attribute haben das Präfix `data-visudev-`, damit sie klar als VisuDEV-relevant erkennbar sind und nicht mit anderen Datenattributen kollidieren.

| Attribut                | Verwendung                                                                | Beispiel                                                                       | Hinweis                                                   |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `data-visudev-screen`   | Optionale Screen-ID oder stabile Kennung für eine Route/Seite             | `data-visudev-screen="projects"`                                               | Wenn gesetzt, kann der Analyzer diese ID/Name bevorzugen. |
| `data-visudev-nav-path` | Nav-/Tab-Item, das zu einem Zielpfad führt (bereits in der Shell genutzt) | `data-nav-path="/appflow"` (bestehend) bzw. `data-visudev-nav-path="/appflow"` | Für exakten Startpunkt von Kanten im App Flow.            |
| `data-visudev-modal`    | Dialog/Modal mit eindeutigem Namen                                        | `data-visudev-modal="new-project"`                                             | Ersetzt generische Namen wie „Modal0“.                    |
| `data-visudev-tab`      | Tab-Panel oder Tab-Trigger mit Wert                                       | `data-visudev-tab="settings"`                                                  | Eindeutige Zuordnung Tab ↔ Screen.                        |
| `data-visudev-trigger`  | Button/Link, der einen Screen/Modal öffnet                                | `data-visudev-trigger="open-settings"`                                         | Optional für Kanten-Trigger-Metadaten.                    |

**Werte:** Nur kurze, stabile Bezeichner (Buchstaben, Zahlen, Bindestriche). Keine Benutzerdaten, keine absoluten URLs, keine Tokens.

---

## Wo setzen (ohne Code schlechter zu machen)

- **Neue Komponenten:** Beim Anlegen neuer Modals/Tabs/Screens die Attribute mit setzen, wo es Mehrwert bringt.
- **Bestehende Komponenten:** Nur dort ergänzen, wo es ohne große Refactorings möglich ist (z. B. eine Wrapper-Komponente oder die Root-Node eines Dialogs).
- **VisuDEV-eigene App:** Die Shell nutzt bereits `data-nav-path` für die Sidebar; das bleibt. Zusätzlich können z. B. zentrale Dialoge („Neues Projekt“, Runner-Dialog) mit `data-visudev-modal` versehen werden.

Es ist **nicht** nötig, jede bestehende Seite oder jedes Dropdown sofort zu markieren.

---

## Analyzer-Verhalten

- **Wenn ein Attribut vorhanden ist:** Der Analyzer kann den Wert als bevorzugte ID/Name/Path nutzen (siehe optionale Anreicherung im Screen-Extraction-Service).
- **Wenn kein Attribut vorhanden ist:** Unverändert Fallback auf die bisherigen Heuristiken (Dateipfad, Komponentennamen, ARIA, Regex). Kein Verhalten wird entfernt oder gebrochen.

---

## Referenzen

- **APPFLOW_MODALS_TABS_DROPDOWNS_KONZEPT.md** – Datenmodell für Modals/Tabs/Dropdowns und Trigger.
- **APPFLOW_NAVIGATION_EDGES_PLAN.md** – Phase 4 (Kanten von Tab-Position); `data-nav-path` in der Shell.
- **LIVE_DOM_REPORT.md** – postMessage und DOM-Report (navItems) für exakte Tab-Startpositionen.
