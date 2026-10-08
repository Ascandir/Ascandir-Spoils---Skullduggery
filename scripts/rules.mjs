/**
 * Regel-Logik für das Plündern. Bewusst ohne Foundry-Objekte, damit sie testbar bleibt.
 */

export const MODULE_ID = "corpse-loot";
/** Eigener Actor-Typ: verschließbarer Container (Truhe, Fass, Schrank ...) mit Beute-Tabelle. */
export const CONTAINER_TYPE = `${MODULE_ID}.container`;
export const SOCKET = `module.${MODULE_ID}`;

/** Diese Item-Typen gelten als Beute. Zauber, Klassen, Talente usw. nie. */
export const LOOT_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

export const COINS = ["pp", "gp", "ep", "sp", "cp"];

/**
 * Ist dieser Gegenstand plünderbar?
 * - nur echte Gegenstände
 * - keine natürlichen Waffen/Rüstungen (Biss, Klauen, natürliche Rüstung)
 * - Inhalte von Behältern erscheinen nicht einzeln, sondern wandern mit dem Behälter
 */
export function isLootableItem(item, { nested = false } = {}) {
  if (!item || !LOOT_TYPES.includes(item.type)) return false;
  if (item.system?.container && !nested) return false;
  const sub = item.system?.type?.value;
  if ((item.type === "weapon" || item.type === "equipment") && sub === "natural") return false;
  return true;
}

/**
 * Abstand zweier Token in Szenen-Einheiten (z. B. Fuß), nach der 5e-Standardregel:
 * Berühren sich die Token, sind es 1 Feld (5 Fuß); jede Lücke von einem Feld kommt dazu.
 * a, b: { x, y, w, h } in Pixeln (x/y = linke obere Ecke)
 */
export function tokenDistance(a, b, { gridSize, gridDistance }) {
  const gapX = Math.max(0, Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) - (a.w + b.w) / 2);
  const gapY = Math.max(0, Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) - (a.h + b.h) / 2);
  const gapCells = Math.max(gapX, gapY) / gridSize;
  return (gapCells + 1) * gridDistance;
}

export function inRange(a, b, grid, range) {
  return tokenDistance(a, b, grid) <= range + 0.01;
}

/** Soll der Gegenstand auf den vorhandenen Stapel gebucht werden? */
export function findStack(items, candidate) {
  if (candidate.type === "container") return null;
  if (candidate.system?.quantity === undefined) return null;
  return (
    items.find(
      (i) => i.type === candidate.type && i.name === candidate.name && i.system?.quantity !== undefined && i.type !== "container"
    ) ?? null
  );
}

export const clampQty = (qty, max) => Math.max(1, Math.min(Math.floor(Number(qty) || 1), max));

const GENERIC_ICON = "icons/svg/item-bag.svg";

/** Darstellung eines Items für das Fenster. Unidentifizierte Gegenstände zeigen Spielern nur den Tarnnamen. */
export function buildItemView(item, { isGM }) {
  const hidden = item.system?.identified === false && !isGM;
  const qty = item.type === "container" ? 1 : Number(item.system?.quantity ?? 1) || 1;
  const price = item.system?.price;
  const weight = item.system?.weight;
  return {
    id: item.id,
    name: hidden ? item.system?.unidentified?.name || "???" : item.name,
    img: hidden ? GENERIC_ICON : item.img,
    type: item.type,
    qty,
    multi: qty > 1,
    isContainer: item.type === "container",
    weight: weight?.value ? `${round(weight.value)} ${weight.units ?? ""}`.trim() : "",
    price: price?.value ? `${round(price.value)} ${price.denomination ?? ""}`.trim() : "",
    unidentified: item.system?.identified === false
  };
}

const round = (n) => Math.round(Number(n) * 100) / 100;

export function nonEmptyCoins(currency = {}) {
  return COINS.filter((k) => Number(currency[k]) > 0).map((k) => ({ key: k, value: Number(currency[k]) }));
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* -------------------------------------------- */
/*  Beute-Tabelle                                */
/* -------------------------------------------- */

/**
 * Aufbau einer Tabelle (gespeichert am Actor):
 * {
 *   enabled: true,
 *   coins: { pp:{min,max}, gp:{min,max}, ep:{...}, sp:{...}, cp:{...} },   // Zufallsbereich pro Token
 *   items: [ { uuid, name, img, kind: "range"|"special", min, max, chance } ]
 * }
 * kind "range"   = Zufallsmenge, fällt immer an (z. B. Pfeile 3-8)
 * kind "special" = fällt nur mit der Drop-Chance in Prozent an (z. B. Heiltrank 25 %)
 * Festes Equipment liegt einfach als normale Gegenstände im Actor.
 */
export const emptyTable = () => ({
  enabled: true,
  coins: Object.fromEntries(COINS.map((k) => [k, { min: 0, max: 0 }])),
  items: []
});

const toInt = (v, fallback = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
};

/** Macht aus beliebigen (z. B. Formular-)Daten eine saubere Tabelle. */
export function normalizeTable(raw = {}) {
  const table = emptyTable();
  table.enabled = raw?.enabled !== false;
  for (const k of COINS) {
    const c = raw?.coins?.[k] ?? {};
    const min = toInt(c.min);
    table.coins[k] = { min, max: Math.max(min, toInt(c.max)) };
  }
  const list = Array.isArray(raw?.items) ? raw.items : Object.values(raw?.items ?? {});
  table.items = list
    .filter((i) => i && typeof i.uuid === "string" && i.uuid)
    .map((i) => {
      const kind = i.kind === "special" ? "special" : "range";
      const min = toInt(i.min, 1);
      return {
        uuid: i.uuid,
        name: String(i.name ?? ""),
        img: String(i.img ?? ""),
        kind,
        min,
        max: Math.max(min, toInt(i.max, min)),
        chance: kind === "special" ? Math.min(100, toInt(i.chance, 100)) : 100
      };
    });
  return table;
}

export const rollInt = (min, max, rand = Math.random) => min + Math.floor(rand() * (max - min + 1));

/** Würfelt eine Tabelle aus. Ergebnis: { coins: {gp: 7}, items: [{uuid,name,img,qty,kind}] } */
export function rollTable(raw, rand = Math.random) {
  const table = normalizeTable(raw);
  const coins = {};
  for (const k of COINS) {
    const n = rollInt(table.coins[k].min, table.coins[k].max, rand);
    if (n > 0) coins[k] = n;
  }
  const items = [];
  for (const it of table.items) {
    if (rand() * 100 >= it.chance) continue; // Chance 100 fällt immer, 0 nie
    const qty = rollInt(it.min, it.max, rand);
    if (qty > 0) items.push({ uuid: it.uuid, name: it.name, img: it.img, kind: it.kind, qty });
  }
  return { coins, items };
}

/** Lesbare Zusammenfassung eines Wurfs (ohne HTML). */
export function describeRoll(result) {
  const parts = [];
  const coins = COINS.filter((k) => result.coins?.[k]).map((k) => `${result.coins[k]} ${k}`);
  if (coins.length) parts.push(coins.join(", "));
  for (const it of result.items ?? []) parts.push(it.qty > 1 ? `${it.qty}× ${it.name}` : it.name);
  return parts.join(", ");
}

/* -------------------------------------------- */
/*  Ernte (Tiere: Fleisch, Fell ...)             */
/* -------------------------------------------- */

/**
 * Eine Ernte-Stufe: Der Spieler muss eine Fertigkeitsprobe schaffen (und optional ein Werkzeug besitzen),
 * erst dann fällt der Ertrag der Stufe an.
 * { id, label, skill, dc, needTool, toolName, tries, items: [{uuid,name,img,min,max}] }
 */
export function normalizeHarvest(raw) {
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list
    .filter((e) => e && typeof e === "object")
    .map((e, i) => {
      const items = (Array.isArray(e.items) ? e.items : Object.values(e.items ?? {}))
        .filter((it) => it && typeof it.uuid === "string" && it.uuid)
        .map((it) => {
          const min = toInt(it.min, 1);
          return { uuid: it.uuid, name: String(it.name ?? ""), img: String(it.img ?? ""), min, max: Math.max(min, toInt(it.max, min)) };
        });
      return {
        id: String(e.id || `h${i}${Math.random().toString(36).slice(2, 7)}`),
        label: String(e.label ?? "").trim() || "Ernte",
        skill: String(e.skill ?? "sur"),
        dc: Math.max(0, toInt(e.dc, 10)),
        needTool: e.needTool === true || e.needTool === "true" || e.needTool === "on",
        toolName: String(e.toolName ?? "").trim(),
        consumeTool: e.consumeTool === true || e.consumeTool === "true" || e.consumeTool === "on",
        consumeOn: e.consumeOn === "attempt" ? "attempt" : "success",
        // Versuche pro Charakter; leer = unbegrenzt. Alte Einträge mit "ein Versuch" bleiben bei 1.
        tries: e.tries !== undefined ? posInt(e.tries) : e.oneTry !== false && e.oneTry !== "false" ? 1 : null,
        items
      };
    });
}

/** Das passende Werkzeug im Inventar (Name enthält den Suchtext, Groß-/Kleinschreibung egal) oder null. */
export function findTool(items, entry) {
  if (!entry.needTool || !entry.toolName) return null;
  const wanted = entry.toolName.toLowerCase();
  return items.find((i) => String(i.name ?? "").toLowerCase().includes(wanted)) ?? null;
}

/** Hat der Charakter das nötige Werkzeug? Ohne Haken oder ohne Namen gibt es nichts zu prüfen. */
export function hasTool(items, entry) {
  if (!entry.needTool || !entry.toolName) return true;
  return Boolean(findTool(items, entry));
}

/** Verbraucht sich das Werkzeug bei diesem Ausgang? */
export function toolIsConsumed(entry, success) {
  return Boolean(entry.needTool && entry.toolName && entry.consumeTool && (success || entry.consumeOn === "attempt"));
}

/**
 * Darf dieser Charakter diese Stufe versuchen?
 * state: { done?: boolean, failed?: string[] }  (pro Token gespeichert)
 */
export function harvestStatus(entry, state, actorId) {
  if (state?.done) return "done";
  if (entry.tries && harvestAttempts(state, actorId) >= entry.tries) return "failed";
  return "open";
}

/** Bisherige Versuche eines Charakters (ältere Stände kannten nur die Liste der Gescheiterten). */
export function harvestAttempts(state, actorId) {
  const n = Number(state?.counts?.[actorId]);
  if (Number.isFinite(n) && n > 0) return n;
  return state?.failed?.includes(actorId) ? 1 : 0;
}

/** Verbleibende Versuche, null = unbegrenzt. */
export function harvestTriesLeft(entry, state, actorId) {
  return entry.tries ? Math.max(0, entry.tries - harvestAttempts(state, actorId)) : null;
}

export const harvestSucceeded = (entry, total) => Number(total) >= entry.dc;

/** Eingegebene Prüfsumme muss eine vernünftige Zahl sein. */
export const isValidTotal = (n) => Number.isFinite(Number(n)) && Number(n) > -100 && Number(n) < 1000;

/* -------------------------------------------- */
/*  Medaille am Beutel: Symbol je Kreaturentyp   */
/* -------------------------------------------- */

const TYPE_ICONS = {
  aberration: "fa-eye", beast: "fa-paw", celestial: "fa-sun", construct: "fa-gears", dragon: "fa-dragon",
  elemental: "fa-wind", fey: "fa-wand-sparkles", fiend: "fa-fire", giant: "fa-mountain", humanoid: "fa-user-shield",
  monstrosity: "fa-spider", ooze: "fa-droplet", plant: "fa-leaf", undead: "fa-skull"
};

/** Font-Awesome-Symbol für den Kreaturentyp (die 14 Typen von D&D 5e); unbekannt oder leer = Beutel. */
export const typeIcon = (key) => TYPE_ICONS[String(key ?? "").toLowerCase()] ?? "fa-sack-dollar";


/* -------------------------------------------- */
/*  Taschendiebstahl und Schlösser               */
/* -------------------------------------------- */

/** Zahl größer 0 oder null (leeres Feld = nicht gesetzt). */
const posInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Schwierigkeitsgrad des Taschendiebstahls: vom Spielleiter gesetzt, sonst die passive Wahrnehmung des Ziels.
 * @param {object|undefined} cfg  Token-Einstellung { dc?: number }
 * @param {number} passive        passive Wahrnehmung des Ziels
 */
export function pickpocketDc(cfg, passive) {
  return posInt(cfg?.dc) ?? posInt(passive) ?? 10;
}

/** Erfolg, wenn der Wurf den SG erreicht. */
export const pickpocketSucceeded = (dc, total) => Number(total) >= dc;

/**
 * Status eines Diebes bei einem Ziel: "open" (noch nichts versucht), "success", "failed".
 * thieves: { [actorId]: { status, granted } }
 */
export function pickpocketStatus(thieves, actorId) {
  const s = thieves?.[actorId]?.status;
  return s === "success" || s === "failed" ? s : "open";
}
export const pickpocketGranted = (thieves, actorId) => Boolean(thieves?.[actorId]?.granted) && pickpocketStatus(thieves, actorId) === "success";

/** Ist Taschendiebstahl an diesem Token erlaubt? Token-Einstellung vor Welt-Einstellung. */
export function pickpocketAllowed(cfg, worldDefault) {
  return typeof cfg?.enabled === "boolean" ? cfg.enabled : Boolean(worldDefault);
}

/** Schloss-Einstellung einer Tür bereinigen. dc = null: Schloss lässt sich nicht knacken. */
export function normalizeLock(raw = {}) {
  return {
    dc: posInt(raw?.dc),
    needTool: raw?.needTool !== false,
    maxTries: posInt(raw?.maxTries),
    keyName: String(raw?.keyName ?? "").trim(),
    keyUuid: String(raw?.keyUuid ?? "").trim()
  };
}

/** Hat die Tür überhaupt etwas, womit man sie öffnen kann? */
export const lockHasOptions = (lock) => Boolean(lock.dc || lock.keyName || lock.keyUuid);

/** Diebeswerkzeug: dnd5e-Werkzeug mit Basis "thief" oder ein Name mit Diebes-/Thieves-Bezug. */
export function isThievesTools(item) {
  if (!item || item.type !== "tool") return false;
  if (item.system?.type?.baseItem === "thief" || item.system?.baseItem === "thief") return true;
  return /thie(f|ves)|dieb/i.test(String(item.name ?? ""));
}
export const findThievesTools = (items) => items.find(isThievesTools) ?? null;

/** Passt dieser Gegenstand zum Schlüssel der Tür? Name (ohne Groß-/Kleinschreibung) oder Quell-UUID. */
export function keyMatches(item, lock) {
  if (!item) return false;
  const name = String(item.name ?? "").trim().toLowerCase();
  if (lock.keyName && name === lock.keyName.toLowerCase()) return true;
  if (lock.keyUuid) {
    const source = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? item.system?.sourceId;
    if (source && source === lock.keyUuid) return true;
    if (item.uuid && item.uuid === lock.keyUuid) return true;
  }
  return false;
}
export const findKey = (items, lock) => items.find((i) => keyMatches(i, lock)) ?? null;

/**
 * Was darf dieser Dieb nehmen? thieves[actorId] = { status, granted (alles), items: [Item-IDs], coins }
 * @returns {{ all: boolean, items: Set<string>, coins: boolean }}
 */
export function pickpocketGrant(thieves, actorId) {
  const t = thieves?.[actorId];
  if (!t || t.status !== "success") return { all: false, items: new Set(), coins: false };
  return { all: Boolean(t.granted), items: new Set(Array.isArray(t.items) ? t.items : []), coins: Boolean(t.coins) };
}

/** Hat die Spielleitung dem Dieb schon irgendetwas freigegeben? */
export const pickpocketHasGrant = (g) => g.all || g.items.size > 0 || g.coins;

/** Wie viele Versuche hat dieser Charakter an der Tür noch? null = unbegrenzt. */
export function triesLeft(lock, attempts, actorId) {
  if (!lock?.maxTries) return null;
  const used = Math.max(0, Math.floor(Number(attempts?.[actorId]) || 0));
  return Math.max(0, lock.maxTries - used);
}
