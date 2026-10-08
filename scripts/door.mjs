import { MODULE_ID, normalizeLock, lockHasOptions, findKey, findThievesTools } from "./rules.mjs";
import * as Service from "./service.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Klick auf eine verschlossene Tür abfangen. Foundry selbst tut dabei nichts außer einem Geräusch.
 * Wir hängen uns in DoorControl, bevor die Steuerungen der Karte gezeichnet werden.
 * @param {() => TokenDocument|null} getLooter  liefert den eigenen Token des Spielers
 */
export function installDoorHook(getLooter) {
  const proto = foundry.canvas?.containers?.DoorControl?.prototype;
  if (!proto || typeof proto._onMouseDown !== "function") {
    console.warn(`${MODULE_ID} | DoorControl nicht gefunden, Schloss-Funktion ist ausgeschaltet.`);
    return;
  }
  if (proto._onMouseDown.__corpseLoot) return;
  const original = proto._onMouseDown;
  const patched = function (event) {
    try {
      if (handleLockedDoorClick(this, event, getLooter)) return;
    } catch (err) {
      console.error(`${MODULE_ID} | Tür-Klick`, err);
    }
    return original.call(this, event);
  };
  patched.__corpseLoot = true;
  proto._onMouseDown = patched;
}

/** true, wenn wir den Klick übernommen haben. */
function handleLockedDoorClick(control, event, getLooter) {
  const button = event?.button ?? event?.data?.button ?? 0;
  if (button !== 0 || game.user.isGM) return false;
  const wall = control.wall?.document;
  if (!wall || wall.ds !== CONST.WALL_DOOR_STATES.LOCKED) return false;
  const lock = normalizeLock(wall.getFlag(MODULE_ID, "lock"));
  if (!lockHasOptions(lock)) return false;
  event.stopPropagation?.();
  openLockDialog(wall, lock, getLooter).catch((err) => {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(t("CLOOT.Err.Crash", { msg: err?.message ?? String(err) }));
  });
  return true;
}

async function openLockDialog(wall, lock, getLooter) {
  const looter = getLooter();
  if (!looter) {
    ui.notifications.warn(t("CLOOT.Notify.SelectToken"));
    return;
  }
  const items = looter.actor.items.contents;
  const hasKey = Boolean(findKey(items, lock));
  const hasTools = !lock.needTool || Boolean(findThievesTools(items));

  const lines = [`<p>${t("CLOOT.Door.Locked")}</p>`];
  if (lock.keyName || lock.keyUuid) lines.push(`<p><i class="fa-solid fa-key"></i> ${hasKey ? t("CLOOT.Door.HaveKey") : t("CLOOT.Door.NoKey")}</p>`);
  if (lock.dc) lines.push(`<p><i class="fa-solid fa-lock"></i> ${hasTools ? t("CLOOT.Door.CanPick") : t("CLOOT.Door.NeedTools")}</p>`);

  const buttons = [];
  if (lock.keyName || lock.keyUuid) buttons.push({ action: "key", label: t("CLOOT.Door.UseKey"), icon: "fa-solid fa-key" });
  if (lock.dc) buttons.push({ action: "pick", label: t("CLOOT.Door.Pick"), icon: "fa-solid fa-lock-open" });
  buttons.push({ action: "cancel", label: t("CLOOT.Door.Cancel"), icon: "fa-solid fa-xmark" });

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("CLOOT.Door.Title"), icon: "fa-solid fa-door-closed" },
    content: lines.join(""),
    buttons,
    rejectClose: false
  });
  const base = { wallUuid: wall.uuid, looterUuid: looter.uuid };

  if (choice === "key") {
    const res = await Service.request("doorKey", base);
    if (!res.ok) ui.notifications.warn(Service.errorText(res));
    return;
  }
  if (choice === "pick") {
    const check = await Service.request("doorCheck", base);
    if (!check.ok) {
      ui.notifications.warn(Service.errorText(check));
      return;
    }
    const rolls = await looter.actor.rollSkill({ skill: check.skill }, {}, {});
    if (!rolls?.length) return;
    const res = await Service.request("doorPick", { ...base, total: rolls[0].total });
    if (!res.ok) ui.notifications.warn(Service.errorText(res));
    else ui.notifications[res.success ? "info" : "warn"](t(res.success ? "CLOOT.Door.Success" : "CLOOT.Door.Failure"));
  }
}

/* -------------------------------------------- */
/*  Wand-Einstellungen (Spielleitung)            */
/* -------------------------------------------- */

/** Fügt dem Fenster einer Wand/Tür die Felder für Schloss und Schlüssel hinzu. */
export function addLockFields(app, html) {
  try {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const form = root?.matches?.("form") ? root : root?.querySelector?.("form");
    const wall = app.document;
    if (!form || wall?.documentName !== "Wall" || form.querySelector(".corpse-loot-lock")) return;
    const lock = normalizeLock(wall.getFlag(MODULE_ID, "lock"));

    const box = document.createElement("fieldset");
    box.className = "corpse-loot-lock";
    box.innerHTML = `
      <legend><i class="fa-solid fa-lock"></i> ${t("CLOOT.Door.Section")}</legend>
      <p class="hint">${t("CLOOT.Door.SectionHint")}</p>
      <div class="form-group">
        <label>${t("CLOOT.Door.DC")}</label>
        <div class="form-fields"><input type="number" min="1" step="1" name="flags.${MODULE_ID}.lock.dc" value="${lock.dc ?? ""}"></div>
        <p class="hint">${t("CLOOT.Door.DCHint")}</p>
      </div>
      <div class="form-group">
        <label>${t("CLOOT.Door.NeedToolsLabel")}</label>
        <div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.lock.needTool" ${lock.needTool ? "checked" : ""}></div>
      </div>
      <div class="form-group">
        <label>${t("CLOOT.Door.KeyName")}</label>
        <div class="form-fields">
          <input type="text" name="flags.${MODULE_ID}.lock.keyName" value="${esc(lock.keyName)}" placeholder="${t("CLOOT.Door.KeyDrop")}">
          <input type="hidden" name="flags.${MODULE_ID}.lock.keyUuid" value="${esc(lock.keyUuid)}">
        </div>
        <p class="hint">${t("CLOOT.Door.KeyHint")}</p>
      </div>`;

    const nameInput = box.querySelector("input[type=text]");
    const uuidInput = box.querySelector("input[type=hidden]");
    nameInput.addEventListener("dragover", (ev) => ev.preventDefault());
    nameInput.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      let data;
      try {
        data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      if (data?.type !== "Item" || !data.uuid) return;
      const item = await fromUuid(data.uuid);
      if (!item) return;
      nameInput.value = item.name;
      uuidInput.value = data.uuid;
    });
    // Wird der Name von Hand geändert, gilt nur noch der Name
    nameInput.addEventListener("input", () => {
      uuidInput.value = "";
    });

    const footer = form.querySelector(".form-footer, footer");
    if (footer) footer.before(box);
    else form.append(box);
    app.setPosition?.({ height: "auto" });
  } catch (err) {
    console.error(`${MODULE_ID} | Schloss-Felder konnten nicht angelegt werden`, err);
  }
}
