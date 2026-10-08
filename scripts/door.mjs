import { MODULE_ID, normalizeLock, lockHasOptions } from "./rules.mjs";
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
  const { LockApp } = await import("./lock-app.mjs");
  const id = `${MODULE_ID}-lock-${wall.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) {
    existing.looterUuid = looter.uuid;
    existing.render({ force: true });
    existing.bringToFront?.();
    return;
  }
  new LockApp({ wallUuid: wall.uuid, looterUuid: looter.uuid }).render({ force: true });
}

// Ändert sich die Tür (aufgeschlossen, Schloss umgestellt), zeigen offene Fenster sofort den neuen Stand
Hooks.on("updateWall", (wall) => {
  const app = foundry.applications.instances.get(`${MODULE_ID}-lock-${wall.uuid.replaceAll(".", "-")}`);
  app?.render();
});

// Gleiches für Container-Token
Hooks.on("updateToken", (token) => {
  const app = foundry.applications.instances.get(`${MODULE_ID}-lock-${token.uuid.replaceAll(".", "-")}`);
  app?.render();
});

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
        <label>${t("CLOOT.Door.MaxTries")}</label>
        <div class="form-fields">
          <input type="number" min="1" step="1" name="flags.${MODULE_ID}.lock.maxTries" value="${lock.maxTries ?? ""}">
          <button type="button" class="corpse-loot-reset"><i class="fa-solid fa-rotate-left"></i> ${t("CLOOT.Door.ResetTries")}</button>
        </div>
        <p class="hint">${t("CLOOT.Door.MaxTriesHint")}</p>
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

    box.querySelector(".corpse-loot-reset").addEventListener("click", async (ev) => {
      ev.preventDefault();
      await wall.update({ [`flags.${MODULE_ID}.-=attempts`]: null });
      ui.notifications.info(t("CLOOT.Door.TriesReset"));
    });

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
