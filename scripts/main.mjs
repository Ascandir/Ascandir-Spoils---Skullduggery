import { MODULE_ID, inRange, tokenDistance, pickpocketAllowed } from "./rules.mjs";
import * as Service from "./service.mjs";
import { installDoorHook, addLockFields } from "./door.mjs";
import { CSS } from "./styles.mjs";

/**
 * Stylesheet direkt einfügen. Das ist unabhängig von Manifest-Stylesheets, Browser-Cache und Foundrys CSS-Layern
 * (ungeschichtete Stile gewinnen immer gegen geschichtete). Gleiche Datei-Schiene wie dieses Skript.
 */
function injectStyles() {
  if (typeof document === "undefined" || !document.head) return;
  if (document.getElementById("corpse-loot-styles")) return;
  const el = document.createElement("style");
  el.id = "corpse-loot-styles";
  el.textContent = CSS;
  document.head.append(el);
}
injectStyles();

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Fehler nicht still verschlucken: in der Konsole UND als rote Meldung in Foundry. */
function reportError(err) {
  console.error(`${MODULE_ID} |`, err);
  ui.notifications.error(t("CLOOT.Err.Crash", { msg: err?.message ?? String(err) }));
}

/* -------------------------------------------- */
/*  Einrichtung                                  */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "range", {
    name: "CLOOT.Setting.Range.Name",
    hint: "CLOOT.Setting.Range.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    range: { min: 5, max: 60, step: 5 }
  });
  game.settings.register(MODULE_ID, "autoRelease", {
    name: "CLOOT.Setting.AutoRelease.Name",
    hint: "CLOOT.Setting.AutoRelease.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, "rollWhen", {
    name: "CLOOT.Setting.RollWhen.Name",
    hint: "CLOOT.Setting.RollWhen.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "death",
    choices: {
      death: "CLOOT.Setting.RollWhen.death",
      placement: "CLOOT.Setting.RollWhen.placement",
      manual: "CLOOT.Setting.RollWhen.manual"
    }
  });
  game.settings.register(MODULE_ID, "bag", {
    name: "CLOOT.Setting.Bag.Name",
    hint: "CLOOT.Setting.Bag.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "pickpocket", {
    name: "CLOOT.Setting.Pickpocket.Name",
    hint: "CLOOT.Setting.Pickpocket.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "doubleClick", {
    name: "CLOOT.Setting.DoubleClick.Name",
    hint: "CLOOT.Setting.DoubleClick.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  // Pro Spieler: Beutel-Button im Rechtsklick-Menü ein- oder ausblenden
  game.settings.register(MODULE_ID, "showHud", {
    name: "CLOOT.Setting.ShowHud.Name",
    hint: "CLOOT.Setting.ShowHud.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "accent", {
    name: "CLOOT.Setting.Accent.Name",
    hint: "CLOOT.Setting.Accent.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.ColorField({ required: true, nullable: false, initial: "#7a1f27" }),
    default: "#7a1f27",
    onChange: applyAccent
  });

  installDoorHook(looterToken);

  game.keybindings.register(MODULE_ID, "loot", {
    name: "CLOOT.Keybind.Loot",
    editable: [{ key: "KeyL" }],
    onDown: () => {
      lootNearby().catch(reportError);
      return true;
    }
  });
});

// Party-Inventar wählbar machen: dnd5e-Gruppen und Item-Piles-Tresore stehen zur Auswahl
Hooks.once("setup", () => {
  const choices = { auto: "CLOOT.Setting.Party.Auto" };
  for (const a of game.actors) {
    const pile = a.getFlag?.("item-piles", "data");
    if (a.type === "group" || pile?.enabled) choices[a.id] = a.name;
  }
  game.settings.register(MODULE_ID, "partyActor", {
    name: "CLOOT.Setting.Party.Name",
    hint: "CLOOT.Setting.Party.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "auto",
    choices
  });
});

Hooks.once("ready", () => {
  Service.initSocket();
  applyAccent();
  game.modules.get(MODULE_ID).api = { lootNearby, openLoot, editTable, editHarvest, rollLoot: rollSelected };
});

function applyAccent() {
  const color = game.settings.get(MODULE_ID, "accent");
  if (color) document.documentElement.style.setProperty("--corpse-loot-accent", String(color));
}

/* -------------------------------------------- */
/*  Hilfen                                       */
/* -------------------------------------------- */

/** Auf dem Spieler-PC prüfen wir nur grob. Die endgültige Prüfung macht immer die Spielleitung. */
const isDeadClient = (td) => Boolean(td?.hasStatusEffect?.("dead") || td?.actor?.statuses?.has("dead"));

/**
 * Lebender NSC, den dieser Spieler bestehlen dürfte. Spieler kennen fremde NSC oft gar nicht als Actor
 * (keine Berechtigung), deshalb darf der Actor hier fehlen. Die endgültige Prüfung macht die Spielleitung.
 */
const isPickableClient = (td) => {
  if (game.user.isGM || !td || td.isOwner) return false;
  const type = td.actor?.type;
  if (type && type !== "npc") return false;
  if (isDeadClient(td)) return false;
  return pickpocketAllowed(td.getFlag(MODULE_ID, "pick"), game.settings.get(MODULE_ID, "pickpocket"));
};

const rectOf = (td) => {
  const size = td.parent.grid.size;
  return { x: td.x, y: td.y, w: td.width * size, h: td.height * size };
};
const gridOf = (scene) => ({ gridSize: scene.grid.size, gridDistance: scene.grid.distance });

/** Der eigene Token des Plünderers: genau ein ausgewählter, sonst der Token des eigenen Charakters. */
function looterToken() {
  const controlled = (canvas.tokens?.controlled ?? []).filter((tk) => tk.actor && !isDeadClient(tk.document));
  if (controlled.length === 1) return controlled[0].document;
  if (controlled.length > 1) return null;
  const mine = game.user.character?.getActiveTokens?.()[0];
  return mine?.document ?? null;
}

/** Alle Leichen in Reichweite eines Tokens, die nächste zuerst. */
export function corpsesNear(looterDoc) {
  const scene = looterDoc.parent;
  const range = Number(game.settings.get(MODULE_ID, "range"));
  const grid = gridOf(scene);
  const a = rectOf(looterDoc);
  return scene.tokens
    .filter((td) => td.id !== looterDoc.id && isDeadClient(td) && inRange(a, rectOf(td), grid, range))
    .map((td) => ({ td, dist: tokenDistance(a, rectOf(td), grid) }))
    .sort((x, y) => x.dist - y.dist)
    .map((e) => e.td);
}

/* -------------------------------------------- */
/*  Fenster öffnen                               */
/* -------------------------------------------- */

export async function openLoot(corpseDoc, looterDoc = null) {
  try {
    await openLootUnsafe(corpseDoc, looterDoc);
  } catch (err) {
    reportError(err);
  }
}

async function openLootUnsafe(corpseDoc, looterDoc) {
  const { LootApp } = await import("./loot-app.mjs");
  const id = `${MODULE_ID}-${corpseDoc.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) {
    existing.render({ force: true });
    existing.bringToFront?.();
    return;
  }
  new LootApp({ tokenUuid: corpseDoc.uuid, looterUuid: looterDoc?.uuid ?? null }).render({ force: true });
}

/**
 * Öffnet das Konfigurationsfenster eines NSC-Actors (nur Spielleitung). Akzeptiert Actor oder Namen.
 * @param {"table"|"harvest"|"preview"} [tab]  Seite, die gezeigt werden soll
 */
export async function editTable(actorOrName, tab = "table") {
  try {
    if (!game.user.isGM) return;
    const actor = typeof actorOrName === "string" ? game.actors.getName(actorOrName) : actorOrName;
    if (!actor || actor.type !== "npc") {
      ui.notifications.warn(t("CLOOT.Notify.TableNeedsNpc"));
      return;
    }
    const { LootTableApp } = await import("./table-app.mjs");
    const id = `${MODULE_ID}-table-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) {
      existing.tab = tab;
      existing.render({ force: true });
      existing.bringToFront?.();
      return;
    }
    new LootTableApp({ actor, tab }).render({ force: true });
  } catch (err) {
    reportError(err);
  }
}

/** Wie editTable, aber direkt auf der Ernte-Seite (für Makros). */
export const editHarvest = (actorOrName) => editTable(actorOrName, "harvest");

/** Würfelt die Beute für alle ausgewählten Token neu (Makro: game.modules.get("corpse-loot").api.rollLoot()). */
export async function rollSelected() {
  try {
    if (!game.user.isGM) return;
    const docs = (canvas.tokens?.controlled ?? []).map((tk) => tk.document);
    if (!docs.length) {
      ui.notifications.warn(t("CLOOT.Notify.SelectToken"));
      return;
    }
    let done = 0;
    for (const td of docs) {
      const res = await Service.rollLoot(td, { force: true, quiet: true });
      if (res.ok) done++;
      else ui.notifications.warn(`${td.name}: ${Service.errorText(res)}`);
    }
    if (done) ui.notifications.info(t("CLOOT.Notify.RolledN", { n: done }));
  } catch (err) {
    reportError(err);
  }
}

/** Taste L: Leiche in Reichweite des eigenen Tokens öffnen. */
export async function lootNearby() {
  if (!canvas?.ready || !canvas.scene) return;

  // Mauszeiger liegt auf einer Leiche: genau die öffnen (so kommen auch Spieler an fremde Token)
  const hovered = canvas.tokens.hover?.document;
  if (hovered && (isDeadClient(hovered) || isPickableClient(hovered))) {
    const looter = looterToken();
    if (!game.user.isGM && !looter) {
      ui.notifications.warn(t("CLOOT.Notify.SelectToken"));
      return;
    }
    return openLoot(hovered, looter);
  }

  // Spielleitung: ausgewählte Leiche direkt öffnen
  if (game.user.isGM) {
    const picked = (canvas.tokens.controlled ?? []).find((tk) => isDeadClient(tk.document));
    if (picked) return openLoot(picked.document, null);
  }

  const looter = looterToken();
  if (!looter) {
    ui.notifications.warn(t("CLOOT.Notify.SelectToken"));
    return;
  }
  const corpses = corpsesNear(looter);
  if (!corpses.length) {
    ui.notifications.info(t("CLOOT.Notify.NothingNear", { range: game.settings.get(MODULE_ID, "range") }));
    return;
  }
  if (corpses.length === 1) return openLoot(corpses[0], looter);

  // Mehrere Leichen: kurze Auswahl
  const buttons = corpses.slice(0, 8).map((td) => ({
    action: td.id,
    label: td.name,
    callback: () => td
  }));
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("CLOOT.Choose") },
    content: `<p>${t("CLOOT.ChooseHint")}</p>`,
    buttons,
    rejectClose: false
  });
  if (choice) await openLoot(choice, looter);
}

/* -------------------------------------------- */
/*  Token-HUD (Rechtsklick-Menü)                 */
/* -------------------------------------------- */

Hooks.on("renderTokenHUD", (hud, html) => {
  try {
    const td = hud.object?.document;
    if (!td) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const column = root?.querySelector?.(".col.right");
    if (!column) return;

    const buttons = [];
    const showLoot = game.settings.get(MODULE_ID, "showHud");
    if (game.user.isGM && td.actor?.type === "npc") {
      // Spielleitung: Beute-Fenster auch für lebende NSC (z. B. um einem Token vorab etwas zu geben)
      if (showLoot) buttons.push({ icon: "fa-sack-dollar", tip: "CLOOT.Keybind.Loot", run: () => openLoot(td, null) });
      buttons.push({ icon: "fa-dice", tip: "CLOOT.Table.Open", run: () => editTable(td.baseActor ?? td.actor) });
    } else if (!isDeadClient(td) && showLoot && corpsesNear(td).length) {
      buttons.push({ icon: "fa-sack-dollar", tip: "CLOOT.Keybind.Loot", run: () => lootNearby() });
    }

    for (const b of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "control-icon corpse-loot-hud";
      button.dataset.tooltip = t(b.tip);
      button.innerHTML = `<i class="fa-solid ${b.icon}"></i>`;
      button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        hud.close?.();
        Promise.resolve(b.run()).catch(reportError);
      });
      column.append(button);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | HUD-Button konnte nicht angelegt werden`, err);
  }
});

/* -------------------------------------------- */
/*  Beute-Tabelle am NSC-Bogen                   */
/* -------------------------------------------- */

// Zusätzlicher Zugang im Kopf des NSC-Bogens (falls dein Setup die Header-Menüs unterstützt).
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  try {
    const doc = app.document;
    if (!game.user.isGM || doc?.documentName !== "Actor" || doc.type !== "npc") return;
    controls.push({
      icon: "fa-solid fa-dice",
      label: "CLOOT.Table.Open",
      action: "corpseLootTable",
      onClick: () => editTable(doc)
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Header-Eintrag konnte nicht angelegt werden`, err);
  }
});

/* -------------------------------------------- */
/*  Automatisch würfeln                          */
/* -------------------------------------------- */

async function autoRoll(td) {
  try {
    if (!td || !Service.isActiveGM()) return;
    const res = await Service.rollLoot(td);
    if (res.ok && res.missing?.length) ui.notifications.warn(t("CLOOT.Notify.Missing", { names: res.missing.join(", ") }));
  } catch (err) {
    reportError(err);
  }
}

// Totenkopf-Status gesetzt: Beute würfeln (einmal pro Token)
Hooks.on("createActiveEffect", (effect) => {
  if (game.settings.get(MODULE_ID, "rollWhen") !== "death") return;
  if (!effect.statuses?.has("dead")) return;
  autoRoll(effect.parent?.token);
});

// Token auf die Karte gezogen: sofort würfeln
Hooks.on("createToken", (td) => {
  if (game.settings.get(MODULE_ID, "rollWhen") !== "placement") return;
  if (td.actor?.type !== "npc") return;
  autoRoll(td);
});

/* -------------------------------------------- */
/*  Doppelklick für Spieler                      */
/* -------------------------------------------- */

Hooks.on("canvasReady", () => {
  const board = canvas.app?.canvas ?? canvas.app?.view ?? document.getElementById("board");
  if (!board || board.dataset.corpseLoot) return;
  board.dataset.corpseLoot = "1";
  board.addEventListener("dblclick", onBoardDoubleClick);
});

/** Foundry kennt fremde Token für Spieler nicht als klickbar. Deshalb prüfen wir selbst, was unter dem Mauszeiger liegt. */
export async function onBoardDoubleClick(ev) {
  try {
    if (game.user.isGM || !game.settings.get(MODULE_ID, "doubleClick")) return;
    if (!canvas?.ready || !canvas.tokens) return;
    const point = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY }) ?? canvas.mousePosition;
    if (!point) return;
    const corpse = canvas.tokens.placeables
      .filter((tk) => tk.visible && (isDeadClient(tk.document) || isPickableClient(tk.document)) && tk.bounds.contains(point.x, point.y))
      .sort((a, b) => (b.document.elevation ?? 0) - (a.document.elevation ?? 0))[0];
    if (!corpse) return;
    const looter = looterToken();
    if (!looter) {
      ui.notifications.warn(t("CLOOT.Notify.SelectToken"));
      return;
    }
    await openLoot(corpse.document, looter);
  } catch (err) {
    reportError(err);
  }
}

/* -------------------------------------------- */
/*  Schlösser: Felder im Wand-Fenster            */
/* -------------------------------------------- */

Hooks.on("renderWallConfig", (app, html) => addLockFields(app, html));
