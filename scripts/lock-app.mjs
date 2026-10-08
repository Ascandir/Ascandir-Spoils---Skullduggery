import { MODULE_ID, normalizeLock, findKey, findThievesTools, triesLeft } from "./rules.mjs";
import * as Service from "./service.mjs";

// Gleiches Fenstersystem und gleicher Lederbeutel wie das Beute-Fenster
const Base = dnd5e.applications.api.Application5e;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export class LockApp extends Base {
  constructor({ wallUuid, looterUuid, ...options }) {
    super({ id: `${MODULE_ID}-lock-${wallUuid.replaceAll(".", "-")}`, ...options });
    this.wallUuid = wallUuid;
    this.looterUuid = looterUuid;
    this.message = "";
    this._busy = false;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["corpse-loot"],
    position: { width: 640, height: "auto" },
    window: { icon: "fa-solid fa-lock", resizable: false },
    actions: {
      useKey: LockApp.onKey,
      pickLock: LockApp.onPick
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lock.hbs` }
  };

  /** @override */
  get title() {
    return t("CLOOT.Door.Title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const wall = fromUuidSync(this.wallUuid);
    const looter = fromUuidSync(this.looterUuid);
    const base = {
      ...context,
      assets: `modules/${MODULE_ID}/assets`,
      bagOn: game.settings.get(MODULE_ID, "bag") !== false,
      message: this.message,
      looterName: looter?.name ?? ""
    };
    if (!wall || !looter?.actor) return { ...base, gone: true };

    const lock = normalizeLock(wall.getFlag(MODULE_ID, "lock"));
    const items = looter.actor.items.contents;
    const open = wall.ds !== CONST.WALL_DOOR_STATES.LOCKED;
    const left = triesLeft(lock, wall.getFlag(MODULE_ID, "attempts"), looter.actor.id);
    const hasKeyOption = Boolean(lock.keyName || lock.keyUuid);
    const hasPickOption = Boolean(lock.dc);
    const hasKey = hasKeyOption && Boolean(findKey(items, lock));
    const hasTools = !lock.needTool || Boolean(findThievesTools(items));
    return {
      ...base,
      open,
      hasKeyOption,
      hasKey,
      hasPickOption,
      needTool: lock.needTool,
      hasTools,
      limited: left !== null,
      left,
      noTries: left === 0,
      canPick: hasPickOption && hasTools && left !== 0 && !open,
      canKey: hasKeyOption && hasKey && !open
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const titleEl = this.element.querySelector(".window-title");
    if (titleEl) titleEl.textContent = this.title;
  }

  async run(fn) {
    if (this._busy) return;
    this._busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(t("CLOOT.Err.Crash", { msg: err?.message ?? String(err) }));
    } finally {
      this._busy = false;
      if (this.rendered) this.render();
    }
  }

  static async onKey() {
    await this.run(async () => {
      const res = await Service.request("doorKey", { wallUuid: this.wallUuid, looterUuid: this.looterUuid });
      if (!res.ok) {
        this.message = Service.errorText(res);
        return;
      }
      ui.notifications.info(t("CLOOT.Door.Success"));
      await this.close();
    });
  }

  /** Erst fragt die Spielleitung, ob der Versuch erlaubt ist. Dann würfelt der Spieler, und nur der Wurf zählt als Versuch. */
  static async onPick() {
    await this.run(async () => {
      const base = { wallUuid: this.wallUuid, looterUuid: this.looterUuid };
      const check = await Service.request("doorCheck", base);
      if (!check.ok) {
        this.message = Service.errorText(check);
        return;
      }
      const actor = fromUuidSync(this.looterUuid)?.actor;
      const rolls = await actor?.rollSkill({ skill: check.skill }, {}, {});
      if (!rolls?.length) return;
      const res = await Service.request("doorPick", { ...base, total: rolls[0].total });
      if (!res.ok) {
        this.message = Service.errorText(res);
        return;
      }
      if (res.success) {
        ui.notifications.info(t("CLOOT.Door.Success"));
        await this.close();
      } else {
        this.message = t("CLOOT.Door.Failure");
      }
    });
  }
}
