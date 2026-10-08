# Ascandir – Spoils & Skullduggery v0.18.0

Tote NSCs und Spielercharaktere (Totenkopf-Status) lassen sich im Umkreis plündern. D&D 5e, Foundry v13/v14.

## Benutzung
**Spieler**
1. Eigenen Token auswählen und neben den toten NSC stellen (max. 10 Fuß, einstellbar).
2. Taste **L** drücken. Am sichersten: Maus auf die Leiche halten und L drücken. Ohne Maus auf einer Leiche
   öffnet L die nächste Leiche in Reichweite. Alternativ: Rechtsklick auf den **eigenen** Token und den Beutel-Button wählen
   (erscheint nur, wenn eine Leiche in Reichweite liegt). Die Leiche selbst lässt sich als Spieler nicht rechtsklicken, das ist in Foundry so.
2b. **Doppelklick** auf die Leiche öffnet das Fenster ebenfalls (eigenen Token vorher auswählen).
3. Im Fenster: **Nehmen** (ins eigene Inventar), **An Gruppe** (ins Gruppeninventar), bei Stapeln vorher die Menge einstellen.
   **Alles nehmen** / **Alles an Gruppe** leert die Leiche inklusive Münzen.

**Spielleitung**
- Leiche auswählen (oder Rechtsklick) und **L** drücken bzw. den Beutel-Button nutzen.
- Mit **Beute freigeben** schaltest du die Beute für die Spieler frei (Chatnachricht inklusive).
  Wer das nicht möchte: in den Moduleinstellungen "Beute automatisch freigeben" einschalten.
- Die Spielleitung muss online sein, weil sie die Übergabe im Hintergrund ausführt.

## Regeln im Modul
- Plünderbar ist nur: NSC mit Totenkopf-Status. Spielercharaktere nie.
- Angezeigt werden Waffen, Rüstung/Ausrüstung, Verbrauchsgüter, Werkzeug, Beute und Behälter.
  Natürliche Angriffe (Biss, Klauen), Talente und Zauber nicht.
- Behälter wandern mit ihrem Inhalt.
- Übernommene Waffen/Rüstung sind nicht ausgerüstet und nicht eingestimmt.
- Unidentifizierte Gegenstände zeigen Spielern nur den Tarnnamen.
- Gleiche Gegenstände werden auf vorhandene Stapel gebucht.
- Das Gruppeninventar ist die Gruppe, in der der Charakter Mitglied ist (oder die einzige Gruppe der Welt).

## Aussehen: der Lederbeutel
Das Beute-Fenster sieht aus wie ein offener Lederbeutel: Messingring mit geflochtenen Kordeln, eine Medaille mit dem
Symbol des Kreaturentyps (Pfote bei der Bestie, Schädel beim Untoten, Drache, Auge, Zahnräder ... für alle 14 Typen
von D&D 5e; Beutel-Symbol bei eigenen Typen), ein Schließen-Knopf rechts oben und eine Naht um die Öffnung.
Innen: die Münzen mit ihren Stapeln, die Ernte-Proben und die Gegenstände als Tabelle (Symbol, Name, Gewicht, Preis, Knöpfe).
Titelleiste und Fensterrahmen von Foundry sind unsichtbar; zum Verschieben den oberen Beutelrand anfassen.

Die Bilder sind fertig gerenderte WebP-Dateien in `assets/bag/`. Sie lassen sich mit gleichem Dateinamen durch eigene ersetzen
(`body.webp` ist ein Rahmen: 1920 x 1400 Bildpunkte, Ränder oben 250, rechts 210, unten 210, links 230, die Mitte bleibt durchsichtig).

**Wenn die Bilder bei jemandem nicht richtig erscheinen:** unter Moduleinstellungen **Beutel-Optik** abschalten (gilt nur für diesen Spieler).
Dann gibt es ein schlichtes dunkles Fenster mit allen Funktionen.

## Makro
`game.modules.get("corpse-loot").api.lootNearby()`

## Beute-Tabelle (für die Spielleitung)
Pro NSC-Actor legst du **einmal** eine Beute-Tabelle an. Jedes Token dieses Actors würfelt seine eigene Beute.
Also: Goblin einmal bauen, sieben Mal auf die Karte ziehen, jeder hat anderes Gold und andere Munition.

**Aufbau des Fensters:** Links sind die Reiter **Loottable**, **Ernte** und **Vorschau**. Sie wechseln nur die Seite im selben Fenster.
Das Fenster lässt sich frei in der Größe ändern: Banner, Reiter und Kacheln passen sich an, nur der Mittelteil scrollt, Kopf und Fußzeile bleiben stehen.
Die Ernte-Seite hat ein eigenes Jagd-Banner.
Im Reiter Loottable stehen die Panels **Währung**, **Munition** (fällt immer an, Menge zufällig) und **Zusatz-Items** (mit Drop-Chance).
Gegenstände einfach auf ein Panel ziehen, das X an der Kachel entfernt sie wieder. **Testen** würfelt einen Beispiel-Loot und zeigt ihn im Reiter Vorschau,
ohne etwas zu speichern oder zu verteilen. Änderungen werden schon beim Eintippen gespeichert, "Loottable speichern" bestätigt das nur.
Elektrum wird nur angezeigt, wenn es in der Tabelle schon eingestellt ist.

**Tabelle öffnen:** Rechtsklick auf ein NSC-Token und den Würfel-Button wählen. Alternativ oben im NSC-Bogen
den Eintrag "Beute-Tabelle" (je nach Foundry-Version vorhanden) oder per Makro:
`game.modules.get("corpse-loot").api.editTable("Goblin")`

**Was die Tabelle kann**
- **Festes Equipment:** ganz normal ins Inventar des NSC legen, jedes Token hat es dann.
- **Münzen:** pro Münzart ein Zufallsbereich (z. B. Gold 2 bis 10). Münzen, die schon im Inventar liegen, bleiben als fester Anteil.
- **Zufällige Mengen:** Gegenstand ins Feld ziehen, Menge von bis (z. B. Pfeile 3 bis 8). Fällt immer an.
- **Spezieller Loot:** Gegenstand ins Feld ziehen, Drop-Chance in Prozent und Menge (z. B. Heiltrank 25 %).
- **Testen:** zeigt dir im Reiter Vorschau, was die Tabelle ergeben würde.

**Wann wird gewürfelt?** (Einstellung "Beute-Tabelle würfeln")
- beim Tod, also sobald der Totenkopf-Status gesetzt wird (Standard),
- sobald das Token auf der Karte liegt,
- oder nur per Button "Beute würfeln" im Beute-Fenster. Dort kannst du auch jederzeit **neu würfeln**.
Pro Token wird nur einmal automatisch gewürfelt. Das Ergebnis siehst du als Flüsternachricht.

**Wichtig:** Das Token darf nicht mit dem Actor verknüpft sein ("Actor-Daten verknüpfen" in den Token-Einstellungen aus,
bei NSCs meist schon der Standard). Sonst würden sich alle Token eine gemeinsame Beute teilen.

## Einstellungen
Foundry: **Einstellungen (Zahnrad) -> Spieleinstellungen konfigurieren -> Moduleinstellungen -> Corpse Loot**.

Nur für die Spielleitung sichtbar (gilt für alle):
- **Reichweite zum Plündern** (Standard 10 Fuß)
- **Beute automatisch freigeben** (aus = Spielleitung gibt jede Leiche frei)
- **Party-Inventar** (Automatisch, oder einen bestimmten Actor wählen)
- **Beute-Tabelle würfeln** (beim Tod / beim Platzieren / manuell)
- **Doppelklick zum Plündern**, **Akzentfarbe**

Für jeden Spieler einzeln:
- **Beutel-Button im Rechtsklick-Menü zeigen** (an/aus)
- **Beutel-Optik** (an/aus, siehe oben)

## Party-Inventar und Item Piles
Neben "Nehmen" gibt es **An Party** (und **Alles an Party**). Ziel ist, in dieser Reihenfolge:
1. der in den Einstellungen gewählte Actor (dnd5e-Gruppen und Item-Piles-Tresore stehen zur Auswahl),
2. die dnd5e-Hauptgruppe,
3. die Gruppe, in der der Charakter Mitglied ist,
4. der einzige Item-Piles-Tresor der Welt.
Ist das Ziel ein Item-Piles-Haufen oder -Tresor, werden Gegenstände über die Item-Piles-Schnittstelle eingelegt.
Ist ein Tresor voll, bleibt der Gegenstand bei der Leiche und es gibt eine Meldung.

## Lebende NSC (Spielleitung)
Der Beutel-Button im Rechtsklick-Menü funktioniert für die Spielleitung auch an **lebenden** NSC.
Gegenstände einfach ins Fenster ziehen, um sie dem Token zu geben, mit dem Mülleimer wieder entfernen.

## Ernte (Tiere: Fleisch, Fell ...)
Im Konfigurationsfenster des Tiers links auf **Ernte** klicken (es öffnet sich kein zweites Fenster, die Seite wechselt nur). Pro Stufe:
- Name (z. B. Fleisch), **Fertigkeit** (Auswahl), **SG**,
- optional **Werkzeug nötig** + Name (z. B. Jagdmesser). Der Charakter muss einen Gegenstand mit diesem Namen im Inventar haben,
- optional **Werkzeug wird verbraucht**, entweder **bei Erfolg** oder **bei jedem Versuch**. Bei Stapeln wird eine Einheit abgezogen, sonst verschwindet der Gegenstand. Freischalten durch die Spielleitung verbraucht nichts,
- **Nur ein Versuch pro Charakter**,
- der **Ertrag** (Gegenstand ins Feld ziehen, Menge von bis).

Im Beute-Fenster sieht der Spieler die Stufen gesperrt. Mit **Probe würfeln** öffnet sich sein normales dnd5e-Würfelfenster.
Schafft er den SG (der bleibt für Spieler verborgen), fällt der Ertrag in die Beute und kann genommen werden.
Die Spielleitung sieht den SG und kann jede Stufe auch **ohne Probe freischalten**.
Hinweis: Das Würfelergebnis kommt vom Spieler-Client, das Modul vertraut ihm (wie am Tisch).

## Hinweis zum Aussehen
Das Stylesheet wird beim Start direkt vom Modul eingefügt (`scripts/styles.mjs`, erzeugt aus `styles/loot.css`).
Es steht bewusst nicht im Manifest, damit es unabhängig von Browser-Cache und Foundrys CSS-Layern greift.
Nach einem Update einmal die Seite hart neu laden (Strg+Shift+R).

## Ohne Spielleitung testen
Ist keine Spielleitung online, bricht das Modul nicht mehr ab: Die Aktion läuft direkt im Client des Spielers.
Die Regeln gelten weiter (Freigabe, Reichweite, nur eigene Token, Spielleitungs-Funktionen bleiben gesperrt).
Schreiben darf der Spieler aber nur, was Foundry ihm erlaubt: Für Gegenstände und Münzen von der Leiche braucht er Besitzer-Rechte
am NSC (oder den Test macht ein Konto mit Assistent-SL-Rechten). Fehlt die Berechtigung, erscheint eine verständliche Meldung,
und der Gegenstand bleibt bei der Leiche.

## Taschendiebstahl (lebende NSC)

Ein Spieler kann einen lebenden NSC oder Spielercharakter (eines anderen Spielers) per Doppelklick oder mit der Taste L (Maus auf dem Token) bestehlen, sofern er in Reichweite ist.
Er würfelt Fingerfertigkeit gegen den SG. Der SG ist standardmäßig die **passive Wahrnehmung** des Ziels, die Spielleitung kann im Beute-Fenster (Zahnrad im Abschnitt „Taschendiebstahl“) einen eigenen SG setzen oder das Stehlen für diesen Token ausschalten.

- Misserfolg: Der Dieb wird erwischt (Chatnachricht für alle), mehr Versuche gibt es nicht.
- Erfolg: Der Dieb sieht alles, was das Ziel trägt, kann aber nichts nehmen. Die Spielleitung bekommt eine private Chatnachricht und entscheidet im Beute-Fenster, **was der Dieb wirklich erwischt**: An jedem Gegenstand (und an den Münzen) sitzen kleine runde Knöpfe mit den Anfangsbuchstaben der erfolgreichen Diebe. Ein Klick gibt den Gegenstand für diesen Dieb frei, ein zweiter sperrt ihn wieder. „Alles freigeben“ in der Taschendiebstahl-Zeile gibt alles auf einmal frei.
- Diebesgut landet immer im Inventar des Diebes (nie in der Gruppe). Gemeldet wird es nur der Spielleitung und dem Dieb.
- Die Spielleitung kann einen Versuch zurücksetzen.
- Die Einstellung „Taschendiebstahl erlauben“ in den Moduleinstellungen gilt als Standard für alle Token.

## Verschlossene Türen

Im Fenster einer Wand/Tür (Spielleitung) gibt es den Abschnitt **Schloss (Corpse Loot)**:

- **SG zum Knacken:** leer = das Schloss lässt sich nicht knacken.
- **Diebeswerkzeug nötig:** Haken an = der Charakter braucht Diebeswerkzeug (Werkzeug „Thieves' Tools“ / Name mit „Diebes“).
- **Schlüssel:** einen Gegenstand ins Feld ziehen oder den Namen eintippen. Wer einen Gegenstand mit genau diesem Namen im Inventar hat, schließt die Tür damit auf.

Klickt ein Spieler auf eine Tür, die auf „Verschlossen“ steht und ein Schloss eingestellt hat, erscheint ein Fenster: Schlüssel benutzen oder Schloss knacken (Fingerfertigkeit). Bei Erfolg wird die Tür entriegelt (sie steht danach auf „Geschlossen“). Türen ohne Schloss-Einstellung verhalten sich wie bisher.

### Versuche an Türen begrenzen

Im Schloss-Abschnitt gibt es **Versuche pro Charakter** (leer = unbegrenzt). Gezählt wird der tatsächliche Würfelwurf, nicht das Öffnen des Fensters. Jeder Charakter hat seine eigenen Versuche. Mit dem Knopf **Versuche zurücksetzen** setzt du die Zähler zurück, bei Erfolg werden sie automatisch gelöscht. Das Fenster zeigt dem Spieler, wie viele Versuche er noch hat.

Das Fenster der verschlossenen Tür nutzt denselben Lederbeutel wie das Beute-Fenster. Auch die kleinen Dialoge (Einstellung des Taschendiebstahls, Auswahl bei mehreren Leichen) und der Schloss-Abschnitt im Wand-Fenster sind im Leder-Design gehalten.
