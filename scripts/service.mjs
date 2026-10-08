import {
  MODULE_ID,
  SOCKET,
  isLootableItem,
  inRange,
  findStack,
  clampQty,
  buildItemView,
  nonEmptyCoins,
  escapeHtml,
  COINS,
  LOOT_TYPES,
  normalizeTable,
  rollTable,
  rollInt,
  describeRoll,
  normalizeHarvest,
  hasTool,
  findTool,
  toolIsConsumed,
  harvestStatus,
  harvestSucceeded,
  isValidTotal
} from "./rules.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const fail = (error, data) => ({ ok: false, error, data });

/** Fehlertext aus einer Antwort (für die Anzeige beim Spieler). */
export const errorText = (res) => (res.data ? game.i18n.format(res.error, res.data) : game.i18n.localize(res.error));

/* -------------------------------------------- */
/*  Offene Fenster                               */
/* -------------------------------------------- */

const openApps = new Map(); // tokenUuid -> Set<App>

export function registerApp(tokenUuid, app) {
  if (!openApps.has(tokenUuid)) openApps.set(tokenUuid, new Set());
  openApps.get(tokenUuid).add(app);
}
export function unregisterApp(tokenUuid, app) {
  openApps.get(tokenUuid)?.delete(app);
}
export function refreshApps(tokenUuid) {
  for (const app of openApps.get(tokenUuid) ?? []) app.render();
}

/* -------------------------------------------- */
/*  Socket                                       */
/* -------------------------------------------- */

const pending = new Map();
export const isActiveGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

export function initSocket() {
  game.socket.on(SOCKET, async (msg) => {
    switch (msg?.kind) {
      case "request": {
        if (!isActiveGM()) return;
        const user = game.users.get(msg.userId);
        let result;
        try {
          result = user ? await gmHandle(user, msg.op, msg.payload ?? {}) : fail("CLOOT.Err.Internal");
        } catch (err) {
          console.error(`${MODULE_ID} | Fehler beim Verarbeiten`, err);
          result = fail("CLOOT.Err.Internal");
        }
        game.socket.emit(SOCKET, { kind: "response", reqId: msg.reqId, userId: msg.userId, result });
        break;
      }
      case "response": {
        if (msg.userId !== game.user.id) return;
        pending.get(msg.reqId)?.(msg.result);
        pending.delete(msg.reqId);
        break;
      }
      case "changed":
        refreshApps(msg.tokenUuid);
        break;
    }
  });
}

/** Sendet eine Anfrage an den Spielleiter. Ist man selbst Spielleiter, wird direkt ausgeführt. */
export async function request(op, payload) {
  if (game.user.isGM) return gmHandle(game.user, op, payload);
  // Keine Spielleitung online: Die Aktion läuft direkt hier. Die Regeln (Freigabe, Reichweite, Besitzer) gelten weiter;
  // schreiben darf der Spieler nur, was Foundry ihm erlaubt. Das macht Tests ohne zweiten Account möglich.
  if (!game.users.activeGM) {
    try {
      return await gmHandle(game.user, op, payload);
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      return fail("CLOOT.Err.Crash", { msg: err?.message ?? String(err) });
    }
  }
  const reqId = foundry.utils.randomID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      resolve(fail("CLOOT.Err.Timeout"));
    }, 10000);
    pending.set(reqId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    game.socket.emit(SOCKET, { kind: "request", reqId, userId: game.user.id, op, payload });
  });
}

function changed(tokenUuid) {
  game.socket.emit(SOCKET, { kind: "changed", tokenUuid });
  refreshApps(tokenUuid);
}

/* -------------------------------------------- */
/*  Prüfungen (laufen immer beim Spielleiter)    */
/* -------------------------------------------- */

export function isCorpse(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.type !== "npc") return false;
  return Boolean(actor.statuses?.has("dead") || tokenDoc.hasStatusEffect?.("dead"));
}

const gridOf = (scene) => ({ gridSize: scene.grid.size, gridDistance: scene.grid.distance });
const rectOf = (td) => {
  const size = td.parent.grid.size;
  return { x: td.x, y: td.y, w: td.width * size, h: td.height * size };
};

/** Ist der Actor ein aktivierter Item-Piles-Haufen/Tresor (und ist Item Piles aktiv)? */
export function isPile(actor) {
  try {
    return Boolean(actor?.getFlag?.("item-piles", "data")?.enabled && game.itempiles?.API?.addItems);
  } catch {
    return false;
  }
}

/** Tresor-Actors von Item Piles (auch wenn das Modul gerade nicht aktiv ist). */
export const isVaultActor = (a) => {
  const d = a?.getFlag?.("item-piles", "data");
  return Boolean(d?.enabled && d.type === "vault");
};

/**
 * Party-Inventar: 1) in den Einstellungen gewählter Actor, 2) dnd5e-Hauptgruppe,
 * 3) Gruppe des Charakters / einzige Gruppe, 4) einziger Item-Piles-Tresor.
 */
export function partyFor(actor) {
  const chosen = game.settings.get(MODULE_ID, "partyActor");
  if (chosen && chosen !== "auto") {
    const picked = game.actors.get(chosen);
    if (picked) return picked;
  }
  if (game.actors.party) return game.actors.party;
  const group = groupFor(actor);
  if (group) return group;
  const piles = game.actors.filter(isVaultActor);
  return piles.length === 1 ? piles[0] : null;
}

export function groupFor(actor) {
  if (!actor) return null;
  const groups = game.actors.filter((a) => a.type === "group");
  return groups.find((g) => g.system.members?.ids?.has(actor.id)) ?? (groups.length === 1 ? groups[0] : null);
}

function resolve(user, p) {
  const corpse = p.tokenUuid ? fromUuidSync(p.tokenUuid) : null;
  if (!corpse?.actor) return fail("CLOOT.Err.NoCorpse");

  const isGM = user.isGM;
  // Die Spielleitung darf auch lebende NSC öffnen (z. B. um einem Token vorab einen Gegenstand zu geben).
  const alive = !isCorpse(corpse);
  if (alive && (!isGM || corpse.actor.type !== "npc")) return fail("CLOOT.Err.NotDead");
  const looter = p.looterUuid ? fromUuidSync(p.looterUuid) : null;
  let canTake = false;

  if (looter?.actor) {
    if (!isGM && !looter.actor.testUserPermission(user, "OWNER")) return fail("CLOOT.Err.NotYourToken");
    if (looter.parent !== corpse.parent) return fail("CLOOT.Err.OtherScene");
    canTake = true;
  }

  if (!isGM) {
    if (!looter?.actor) return fail("CLOOT.Err.NoLooter");
    const range = Number(game.settings.get(MODULE_ID, "range"));
    if (!inRange(rectOf(looter), rectOf(corpse), gridOf(corpse.parent), range)) return fail("CLOOT.Err.TooFar");
  }

  const requireRelease = !game.settings.get(MODULE_ID, "autoRelease");
  const released = Boolean(corpse.getFlag(MODULE_ID, "released"));
  const locked = !isGM && requireRelease && !released;

  return { ok: true, user, isGM, alive, corpse, actor: corpse.actor, looter, canTake: canTake && !locked, locked, released, requireRelease };
}

/* -------------------------------------------- */
/*  Aktionen                                     */
/* -------------------------------------------- */

export async function gmHandle(user, op, p) {
  const ctx = resolve(user, p);
  if (!ctx.ok) return ctx;
  switch (op) {
    case "state":
      return { ok: true, state: buildState(ctx) };
    case "take":
      return takeItem(ctx, p);
    case "coins":
      return takeCoins(ctx, p);
    case "all":
      return takeAll(ctx, p);
    case "release":
      return toggleRelease(ctx);
    case "roll":
      return rollOp(ctx);
    case "gmAdd":
      return gmAdd(ctx, p);
    case "gmRemove":
      return gmRemove(ctx, p);
    case "harvestCheck":
      return harvestCheck(ctx, p);
    case "harvestResolve":
      return harvestResolve(ctx, p);
    case "harvestUnlock":
      return harvestUnlock(ctx, p);
    default:
      return fail("CLOOT.Err.Internal");
  }
}

function buildState(ctx) {
  const group = ctx.looter ? partyFor(ctx.looter.actor) : null;
  const items = ctx.locked
    ? []
    : ctx.actor.items
        .filter(isLootableItem)
        .map((i) => ({ ...buildItemView(i, { isGM: ctx.isGM }), canTake: ctx.canTake, canGroup: ctx.canTake && Boolean(group), canManage: ctx.isGM }));
  const coins = ctx.locked ? [] : nonEmptyCoins(ctx.actor.system.currency);
  const hasTable = Boolean((ctx.corpse.baseActor ?? ctx.actor).getFlag(MODULE_ID, "table"));
  const harvest = ctx.locked ? [] : harvestViews(ctx);
  return {
    harvest,
    hasHarvest: harvest.length > 0,
    alive: ctx.alive,
    hasTable,
    rolled: Boolean(ctx.corpse.getFlag(MODULE_ID, "rolled")),
    canRoll: ctx.isGM && hasTable,
    tokenUuid: ctx.corpse.uuid,
    name: ctx.corpse.name,
    creatureType: ctx.actor.system?.details?.type?.value ?? "",
    img: ctx.actor.img,
    isGM: ctx.isGM,
    released: ctx.released,
    requireRelease: ctx.requireRelease,
    locked: ctx.locked,
    canTake: ctx.canTake,
    looterName: ctx.looter?.name ?? "",
    group: group ? { name: group.name } : null,
    items,
    coins,
    hasCoins: coins.length > 0,
    isEmpty: items.length === 0 && coins.length === 0 && harvest.length === 0
  };
}

const destination = (ctx, to) => (to === "group" ? partyFor(ctx.looter?.actor) : ctx.looter?.actor);

async function takeItem(ctx, p) {
  if (!ctx.canTake) return fail(ctx.locked ? "CLOOT.Err.Locked" : "CLOOT.Err.NoLooter");
  const item = ctx.actor.items.get(p.itemId);
  if (!item || !isLootableItem(item)) return fail("CLOOT.Err.ItemGone");
  const dest = destination(ctx, p.to);
  if (!dest) return fail("CLOOT.Err.NoGroup");

  const max = item.type === "container" ? 1 : Number(item.system.quantity ?? 1) || 1;
  const qty = clampQty(p.qty ?? max, max);
  const name = displayName(item, ctx.isGM);

  try {
    await moveItem(ctx.actor, item, qty, dest);
  } catch (err) {
    console.error(`${MODULE_ID} | Zustellung fehlgeschlagen`, err);
    return fail("CLOOT.Err.Deliver", { msg: err?.message ?? String(err) });
  }
  await announce(ctx, p.to, [{ name, qty }], []);
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

async function takeCoins(ctx, p) {
  if (!ctx.canTake) return fail(ctx.locked ? "CLOOT.Err.Locked" : "CLOOT.Err.NoLooter");
  const dest = destination(ctx, p.to);
  if (!dest) return fail("CLOOT.Err.NoGroup");
  const coins = await moveCoins(ctx.actor, dest);
  if (!coins.length) return fail("CLOOT.Err.NoCoins");
  await announce(ctx, p.to, [], coins);
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

async function takeAll(ctx, p) {
  if (!ctx.canTake) return fail(ctx.locked ? "CLOOT.Err.Locked" : "CLOOT.Err.NoLooter");
  const dest = destination(ctx, p.to);
  if (!dest) return fail("CLOOT.Err.NoGroup");

  const taken = [];
  for (const item of ctx.actor.items.filter(isLootableItem)) {
    const max = item.type === "container" ? 1 : Number(item.system.quantity ?? 1) || 1;
    const name = displayName(item, ctx.isGM);
    try {
      await moveItem(ctx.actor, item, max, dest);
    } catch (err) {
      console.error(`${MODULE_ID} | Zustellung fehlgeschlagen`, err);
      if (!taken.length) return fail("CLOOT.Err.Deliver", { msg: err?.message ?? String(err) });
      break;
    }
    taken.push({ name, qty: max });
  }
  const coins = await moveCoins(ctx.actor, dest);
  if (!taken.length && !coins.length) return fail("CLOOT.Err.Empty");
  await announce(ctx, p.to, taken, coins);
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

async function toggleRelease(ctx) {
  if (!ctx.isGM) return fail("CLOOT.Err.GMOnly");
  const now = !ctx.released;
  await ctx.corpse.setFlag(MODULE_ID, "released", now);
  if (now) {
    await ChatMessage.create({
      content: `<div class="corpse-loot-chat"><p>${t("CLOOT.Chat.Released", { name: escapeHtml(ctx.corpse.name) })}</p></div>`
    });
  }
  ctx.released = now;
  ctx.locked = false;
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

/* -------------------------------------------- */
/*  Übertragung                                  */
/* -------------------------------------------- */

const displayName = (item, isGM) =>
  item.system?.identified === false && !isGM ? item.system?.unidentified?.name || "???" : item.name;

async function moveItem(srcActor, item, qty, dstActor) {
  const max = item.type === "container" ? 1 : Number(item.system.quantity ?? 1) || 1;
  if (item.type !== "container" && isPile(dstActor)) {
    // Item-Piles-Haufen/Tresor: über deren Schnittstelle einlegen (Stapel, Tresor-Platz, Protokoll)
    const data = item.toObject();
    delete data._id;
    delete data.ownership;
    if ("equipped" in data.system) data.system.equipped = false;
    if ("attuned" in data.system) data.system.attuned = false;
    await game.itempiles.API.addItems(dstActor, [{ item: data, quantity: qty }]);
  } else {
    const stack = findStack(dstActor.items.contents, item);
    if (stack) await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + qty });
    else await copyTree(item, dstActor, null, item.type === "container" ? null : qty);
  }

  if (qty >= max) {
    if (item.type === "container") {
      const childIds = Array.from(item.system.allContainedItems.keys());
      if (childIds.length) await srcActor.deleteEmbeddedDocuments("Item", childIds);
    }
    if (srcActor.items.has(item.id)) await srcActor.deleteEmbeddedDocuments("Item", [item.id]);
  } else {
    await item.update({ "system.quantity": max - qty });
  }
}

async function copyTree(src, dst, parentId, qty) {
  const data = src.toObject();
  delete data._id;
  delete data.ownership;
  data.system.container = parentId;
  if (qty != null && data.system.quantity !== undefined) data.system.quantity = qty;
  if ("equipped" in data.system) data.system.equipped = false;
  if ("attuned" in data.system) data.system.attuned = false;
  const [created] = await dst.createEmbeddedDocuments("Item", [data]);
  if (src.type === "container") {
    for (const child of src.system.contents.values()) await copyTree(child, dst, created.id, null);
  }
  return created;
}

async function moveCoins(srcActor, dstActor) {
  const coins = nonEmptyCoins(srcActor.system.currency);
  if (!coins.length) return [];
  const have = dstActor.system.currency ?? {};
  const add = {};
  const clear = {};
  for (const c of coins) {
    add[`system.currency.${c.key}`] = (Number(have[c.key]) || 0) + c.value;
    clear[`system.currency.${c.key}`] = 0;
  }
  await dstActor.update(add);
  await srcActor.update(clear);
  return coins;
}

async function announce(ctx, to, items, coins) {
  const parts = items.map((e) => `${escapeHtml(e.name)}${e.qty > 1 ? ` ×${e.qty}` : ""}`);
  if (coins.length) parts.push(coins.map((c) => `${c.value} ${c.key}`).join(", "));
  const group = to === "group" ? partyFor(ctx.looter?.actor) : null;
  const text = t(to === "group" ? "CLOOT.Chat.TakeGroup" : "CLOOT.Chat.TakeSelf", {
    who: escapeHtml(ctx.looter?.name ?? ctx.user.name),
    what: parts.join(", "),
    from: escapeHtml(ctx.corpse.name),
    group: escapeHtml(group?.name ?? "")
  });
  await ChatMessage.create({
    content: `<div class="corpse-loot-chat"><p>${text}</p></div>`,
    speaker: { alias: ctx.looter?.name ?? ctx.user.name }
  });
}

/* -------------------------------------------- */
/*  Beute würfeln (Beute-Tabelle am Actor)       */
/* -------------------------------------------- */

async function rollOp(ctx) {
  if (!ctx.isGM) return fail("CLOOT.Err.GMOnly");
  const res = await rollLoot(ctx.corpse, { force: true });
  if (!res.ok) return res;
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

/**
 * Würfelt die Beute-Tabelle des Actors für genau dieses Token (nur Spielleitung).
 * - Münzen und Gegenstände landen im Inventar des Tokens (bei unverknüpften Token nur bei diesem Token).
 * - Frühere gewürfelte Beute wird beim erneuten Würfeln wieder entfernt.
 * @param {TokenDocument} tokenDoc
 * @param {{force?: boolean, quiet?: boolean}} [options]
 */
export async function rollLoot(tokenDoc, { force = false, quiet = false } = {}) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.type !== "npc") return fail("CLOOT.Err.NoCorpse");
  const raw = (tokenDoc.baseActor ?? actor).getFlag(MODULE_ID, "table");
  if (!raw) return fail("CLOOT.Err.NoTable");
  const table = normalizeTable(raw);
  if (!table.enabled) return fail("CLOOT.Err.TableOff");
  if (tokenDoc.actorLink) return fail("CLOOT.Err.Linked");
  if (!force && tokenDoc.getFlag(MODULE_ID, "rolled")) return fail("CLOOT.Err.AlreadyRolled");

  // Früher gewürfelte Gegenstände und Münzen zurücknehmen (nur bei erneutem Würfeln relevant)
  const oldItems = actor.items.filter((i) => i.getFlag(MODULE_ID, "generated")).map((i) => i.id);
  if (oldItems.length) await actor.deleteEmbeddedDocuments("Item", oldItems);
  const prev = tokenDoc.getFlag(MODULE_ID, "genCoins") ?? {};

  const result = rollTable(table);

  const update = {};
  for (const k of COINS) {
    const cur = Number(actor.system.currency?.[k]) || 0;
    const next = Math.max(0, cur - (Number(prev[k]) || 0)) + (result.coins[k] || 0);
    if (next !== cur) update[`system.currency.${k}`] = next;
  }
  if (Object.keys(update).length) await actor.update(update);

  const docs = [];
  const missing = [];
  for (const it of result.items) {
    const src = await fromUuid(it.uuid);
    if (!src) {
      missing.push(it.name || it.uuid);
      continue;
    }
    const data = src.toObject();
    delete data._id;
    delete data.ownership;
    data.system.container = null;
    if (data.system.quantity !== undefined) data.system.quantity = it.qty;
    if ("equipped" in data.system) data.system.equipped = false;
    if ("attuned" in data.system) data.system.attuned = false;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.generated`, true);
    docs.push(data);
  }
  if (docs.length) await actor.createEmbeddedDocuments("Item", docs);

  await tokenDoc.setFlag(MODULE_ID, "rolled", true);
  await tokenDoc.setFlag(MODULE_ID, "genCoins", Object.fromEntries(COINS.map((k) => [k, result.coins[k] || 0])));

  if (!quiet) {
    const what = describeRoll(result) || t("CLOOT.Table.NothingRolled");
    await ChatMessage.create({
      content: `<div class="corpse-loot-chat"><p>${t("CLOOT.Chat.Rolled", {
        name: escapeHtml(tokenDoc.name),
        what: escapeHtml(what)
      })}</p></div>`,
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id)
    });
  }
  return { ok: true, result, missing };
}

/* -------------------------------------------- */
/*  Spielleitung: Gegenstände verwalten          */
/* -------------------------------------------- */

async function gmAdd(ctx, p) {
  if (!ctx.isGM) return fail("CLOOT.Err.GMOnly");
  const src = p.uuid ? await fromUuid(p.uuid) : null;
  if (!src || !LOOT_TYPES.includes(src.type)) return fail("CLOOT.Table.NotAnItem");
  const stack = findStack(ctx.actor.items.contents, src);
  const addQty = Number(src.system?.quantity ?? 1) || 1;
  if (stack) {
    await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + addQty });
  } else {
    const data = src.toObject();
    delete data._id;
    delete data.ownership;
    data.system.container = null;
    await ctx.actor.createEmbeddedDocuments("Item", [data]);
  }
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

async function gmRemove(ctx, p) {
  if (!ctx.isGM) return fail("CLOOT.Err.GMOnly");
  const item = ctx.actor.items.get(p.itemId);
  if (!item) return fail("CLOOT.Err.ItemGone");
  if (item.type === "container") {
    const childIds = Array.from(item.system.allContainedItems.keys());
    if (childIds.length) await ctx.actor.deleteEmbeddedDocuments("Item", childIds);
  }
  if (ctx.actor.items.has(item.id)) await ctx.actor.deleteEmbeddedDocuments("Item", [item.id]);
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

/* -------------------------------------------- */
/*  Ernte                                        */
/* -------------------------------------------- */

const skillLabel = (key) => globalThis.CONFIG?.DND5E?.skills?.[key]?.label ?? key;
const harvestEntries = (ctx) => normalizeHarvest((ctx.corpse.baseActor ?? ctx.actor).getFlag(MODULE_ID, "harvest") ?? []);
const harvestFlag = (ctx) => ctx.corpse.getFlag(MODULE_ID, "harvest") ?? {};

function harvestViews(ctx) {
  const state = harvestFlag(ctx);
  const myId = ctx.looter?.actor?.id;
  return harvestEntries(ctx).map((e) => {
    const status = harvestStatus(e, state[e.id], myId);
    return {
      id: e.id,
      label: e.label,
      skillLabel: skillLabel(e.skill),
      needTool: e.needTool,
      toolName: e.toolName,
      consumeTool: e.needTool && e.consumeTool && Boolean(e.toolName),
      isDone: status === "done",
      isFailed: status === "failed",
      isOpen: status === "open",
      canTry: ctx.canTake && status === "open",
      dc: ctx.isGM ? e.dc : null,
      isGM: ctx.isGM
    };
  });
}

/** Gemeinsame Prüfung für Probe-Start und Auswertung. */
function harvestGate(ctx, p) {
  if (!ctx.canTake) return fail(ctx.locked ? "CLOOT.Err.Locked" : "CLOOT.Err.NoLooter");
  const entry = harvestEntries(ctx).find((e) => e.id === p.entryId);
  if (!entry) return fail("CLOOT.Err.NoHarvest");
  const status = harvestStatus(entry, harvestFlag(ctx)[entry.id], ctx.looter.actor.id);
  if (status === "done") return fail("CLOOT.Err.HarvestDone");
  if (status === "failed") return fail("CLOOT.Err.HarvestFailed");
  if (!hasTool(ctx.looter.actor.items.contents, entry)) return fail("CLOOT.Err.NeedTool", { tool: entry.toolName });
  return { ok: true, entry };
}

/** Schritt 1: darf der Spieler würfeln? Verrät den Schwierigkeitsgrad nicht. */
async function harvestCheck(ctx, p) {
  const gate = harvestGate(ctx, p);
  if (!gate.ok) return gate;
  return { ok: true, skill: gate.entry.skill };
}

/** Schritt 2: der Spieler hat gewürfelt, die Spielleitung wertet aus. */
async function harvestResolve(ctx, p) {
  const gate = harvestGate(ctx, p);
  if (!gate.ok) return gate;
  if (!isValidTotal(p.total)) return fail("CLOOT.Err.Internal");
  const { entry } = gate;
  const success = harvestSucceeded(entry, p.total);
  const state = { ...harvestFlag(ctx) };
  if (success) state[entry.id] = { done: true, failed: [] };
  else {
    const prev = state[entry.id] ?? {};
    state[entry.id] = { done: false, failed: [...new Set([...(prev.failed ?? []), ctx.looter.actor.id])] };
  }
  await ctx.corpse.setFlag(MODULE_ID, "harvest", state);
  const got = success ? await grantHarvest(ctx.actor, entry) : [];
  const used = toolIsConsumed(entry, success) ? await consumeTool(ctx.looter.actor, entry) : null;
  await announceHarvest(ctx, entry, success, got, used);
  changed(ctx.corpse.uuid);
  return { ok: true, success, state: buildState(ctx) };
}

/** Spielleitung schaltet eine Stufe ohne Probe frei. */
async function harvestUnlock(ctx, p) {
  if (!ctx.isGM) return fail("CLOOT.Err.GMOnly");
  const entry = harvestEntries(ctx).find((e) => e.id === p.entryId);
  if (!entry) return fail("CLOOT.Err.NoHarvest");
  const state = { ...harvestFlag(ctx) };
  if (state[entry.id]?.done) return fail("CLOOT.Err.HarvestDone");
  state[entry.id] = { done: true, failed: [] };
  await ctx.corpse.setFlag(MODULE_ID, "harvest", state);
  await grantHarvest(ctx.actor, entry);
  changed(ctx.corpse.uuid);
  return { ok: true, state: buildState(ctx) };
}

/** Würfelt den Ertrag einer Stufe und legt ihn in die Beute der Leiche. */
async function grantHarvest(actor, entry) {
  const docs = [];
  const got = [];
  for (const it of entry.items) {
    const qty = rollInt(it.min, it.max);
    if (qty <= 0) continue;
    const src = await fromUuid(it.uuid);
    if (!src) continue;
    const data = src.toObject();
    delete data._id;
    delete data.ownership;
    data.system.container = null;
    if (data.system.quantity !== undefined) data.system.quantity = qty;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.harvested`, entry.id);
    docs.push(data);
    got.push({ name: it.name || src.name, qty });
  }
  if (docs.length) await actor.createEmbeddedDocuments("Item", docs);
  return got;
}

/** Zieht das benutzte Werkzeug ab (eine Einheit bei Stapeln, sonst wird der Gegenstand entfernt). */
async function consumeTool(actor, entry) {
  const tool = findTool(actor.items.contents, entry);
  if (!tool) return null;
  const name = tool.name;
  const qty = Number(tool.system?.quantity);
  if (Number.isFinite(qty) && qty > 1) await tool.update({ "system.quantity": qty - 1 });
  else await actor.deleteEmbeddedDocuments("Item", [tool.id]);
  return name;
}

async function announceHarvest(ctx, entry, success, got, used = null) {
  const what = got.map((g) => (g.qty > 1 ? `${escapeHtml(g.name)} ×${g.qty}` : escapeHtml(g.name))).join(", ");
  const key = success ? "CLOOT.Chat.HarvestOk" : "CLOOT.Chat.HarvestFail";
  const usedLine = used ? `<p>${t("CLOOT.Chat.ToolUsed", { tool: escapeHtml(used) })}</p>` : "";
  await ChatMessage.create({
    content: `<div class="corpse-loot-chat"><p>${t(key, {
      who: escapeHtml(ctx.looter.name),
      label: escapeHtml(entry.label),
      from: escapeHtml(ctx.corpse.name),
      what
    })}</p>${usedLine}</div>`,
    speaker: { alias: ctx.looter.name }
  });
}
