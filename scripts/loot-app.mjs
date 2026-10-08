import { MODULE_ID, typeIcon } from "./rules.mjs";

/** Gravierte Medaillons (assets/types/<typ>.webp) */
const TYPE_MEDALS = new Set(["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "fungi", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"]);
import * as Service from "./service.mjs";

// Das dnd5e-Fenstersystem sorgt automatisch für denselben Rahmen, dieselbe Schrift und das gleiche Hell/Dunkel-Theme wie die Charakterbögen.
const Base = dnd5e.applications.api.Application5e;

export class LootApp extends Base {
  constructor({ tokenUuid, looterUuid = null, ...options }) {
    super({ id: `${MODULE_ID}-${tokenUuid.replaceAll(".", "-")}`, ...options });
    this.tokenUuid = tokenUuid;
    this.looterUuid = looterUuid;
    this.lootState = null;
    this._busy = false;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["corpse-loot"],
    position: { width: 900, height: "auto" },
    window: { icon: "fa-solid fa-sack-dollar", resizable: true },
    actions: {
      take: LootApp.onTake,
      coins: LootApp.onCoins,
      all: LootApp.onAll,
      release: LootApp.onRelease,
      roll: LootApp.onRoll,
      harvest: LootApp.onHarvest,
      unlock: LootApp.onUnlock,
      gmRemove: LootApp.onGmRemove,
      openTable: LootApp.onOpenTable,
      pickRoll: LootApp.onPickRoll,
      pickConfig: LootApp.onPickConfig,
      pickGrant: LootApp.onPickGrant,
      pickReset: LootApp.onPickReset,
      pickItem: LootApp.onPickItem,
      pickCoins: LootApp.onPickCoins,
      refresh: LootApp.onRefresh
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/loot.hbs` }
  };

  /** @override */
  get title() {
    return game.i18n.format("CLOOT.Title", { name: this.lootState?.name ?? "" });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const res = await Service.request("state", { tokenUuid: this.tokenUuid, looterUuid: this.looterUuid });
    if (!res.ok) {
      this.lootState = null;
      return { ...context, ...this.bagContext(null), error: Service.errorText(res) };
    }
    this.lootState = res.state;
    return { ...context, ...this.bagContext(res.state), state: res.state };
  }

  /** Alles, was der Beutel zusätzlich braucht: Bilder, Medaille (Symbol des Kreaturentyps), Münzen mit Namen. */
  bagContext(state) {
    const typeKey = String(state?.creatureType ?? "").toLowerCase();
    const fromConfig = typeKey ? CONFIG.DND5E?.creatureTypes?.[typeKey]?.label : null;
    return {
      assets: `modules/${MODULE_ID}/assets`,
      bagOn: game.settings.get(MODULE_ID, "bag") !== false,
      typeIcon: typeIcon(typeKey),
      typeKey: TYPE_MEDALS.has(typeKey) ? typeKey : "",
      typeLabel: fromConfig ? game.i18n.localize(fromConfig) : "",
      coinList: (state?.coins ?? []).map((c) => ({ ...c, label: game.i18n.localize(`CLOOT.Cfg.Coin.${c.key}`) }))
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    Service.registerApp(this.tokenUuid, this);
  }

  /** @override */
  async _onClose(options) {
    Service.unregisterApp(this.tokenUuid, this);
    return super._onClose?.(options);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Der Titel kennt den Namen erst nach dem Laden der Daten
    const titleEl = this.element.querySelector(".window-title");
    if (titleEl) titleEl.textContent = this.title;
    // Spielleitung: Gegenstände ins Fenster ziehen, um sie dem Token zu geben
    for (const zone of this.element.querySelectorAll("[data-gm-drop]")) {
      zone.addEventListener("dragenter", () => zone.classList.add("dragover"));
      zone.addEventListener("dragleave", (ev) => {
        if (!zone.contains(ev.relatedTarget)) zone.classList.remove("dragover");
      });
      zone.addEventListener("dragover", (ev) => ev.preventDefault());
      zone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        zone.classList.remove("dragover");
        let data;
        try {
          data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        } catch {
          return;
        }
        if (data?.type === "Item" && data.uuid) await this.act("gmAdd", { uuid: data.uuid });
      });
    }
  }

  /** Führt eine Aktion beim Spielleiter aus und zeigt danach den neuen Stand. */
  async act(op, extra = {}) {
    if (this._busy) return;
    this._busy = true;
    try {
      const res = await Service.request(op, { tokenUuid: this.tokenUuid, looterUuid: this.looterUuid, ...extra });
      if (!res.ok) ui.notifications.warn(Service.errorText(res));
    } finally {
      this._busy = false;
      this.render();
    }
  }

  static async onTake(event, target) {
    const row = target.closest("[data-item-id]");
    const qty = row?.querySelector("input[data-role='qty']")?.value;
    await this.act("take", { itemId: row?.dataset.itemId, to: target.dataset.to, qty });
  }

  static async onCoins(event, target) {
    await this.act("coins", { to: target.dataset.to });
  }

  static async onAll(event, target) {
    await this.act("all", { to: target.dataset.to });
  }

  static async onRelease() {
    await this.act("release");
  }

  /**
   * Ernte-Probe: Erst fragt die Spielleitung, ob der Versuch erlaubt ist (Werkzeug, noch nicht gescheitert).
   * Dann würfelt der Spieler selbst (dnd5e zeigt sein normales Würfelfenster), danach wertet die Spielleitung aus.
   */
  static async onHarvest(event, target) {
    if (this._busy) return;
    this._busy = true;
    try {
      const base = { tokenUuid: this.tokenUuid, looterUuid: this.looterUuid, entryId: target.dataset.entry };
      const check = await Service.request("harvestCheck", base);
      if (!check.ok) {
        ui.notifications.warn(Service.errorText(check));
        return;
      }
      const actor = fromUuidSync(this.looterUuid)?.actor;
      const rolls = await actor?.rollSkill({ skill: check.skill }, {}, {});
      if (!rolls?.length) return; // Würfelfenster abgebrochen
      const res = await Service.request("harvestResolve", { ...base, total: rolls[0].total });
      if (!res.ok) ui.notifications.warn(Service.errorText(res));
      else ui.notifications[res.success ? "info" : "warn"](game.i18n.localize(res.success ? "CLOOT.Harvest.Success" : "CLOOT.Harvest.Failure"));
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(game.i18n.format("CLOOT.Err.Crash", { msg: err?.message ?? String(err) }));
    } finally {
      this._busy = false;
      this.render();
    }
  }

  /** Taschendiebstahl: Die Spielleitung prüft, der Spieler würfelt Fingerfertigkeit, die Spielleitung wertet gegen den SG aus. */
  static async onPickRoll() {
    if (this._busy) return;
    this._busy = true;
    try {
      const base = { tokenUuid: this.tokenUuid, looterUuid: this.looterUuid };
      const check = await Service.request("pickCheck", base);
      if (!check.ok) {
        ui.notifications.warn(Service.errorText(check));
        return;
      }
      const actor = fromUuidSync(this.looterUuid)?.actor;
      const rolls = await actor?.rollSkill({ skill: check.skill }, {}, {});
      if (!rolls?.length) return;
      const res = await Service.request("pickResolve", { ...base, total: rolls[0].total });
      if (!res.ok) ui.notifications.warn(Service.errorText(res));
      else ui.notifications[res.success ? "info" : "warn"](game.i18n.localize(res.success ? "CLOOT.Pick.Success" : "CLOOT.Pick.Failure"));
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(game.i18n.format("CLOOT.Err.Crash", { msg: err?.message ?? String(err) }));
    } finally {
      this._busy = false;
      this.render();
    }
  }

  /** Spielleitung: Taschendiebstahl an/aus und eigener Schwierigkeitsgrad. */
  static async onPickConfig() {
    const cfg = this.lootState?.pickGM;
    if (!cfg) return;
    const t = (k) => game.i18n.localize(k);
    const data = await foundry.applications.api.DialogV2.prompt({
      classes: ["cl-dialog"],
      window: { title: t("CLOOT.Pick.Config"), icon: "fa-solid fa-hand-holding" },
      content: `
        <div class="form-group"><label>${t("CLOOT.Pick.Allow")}</label>
          <div class="form-fields"><input type="checkbox" name="enabled" ${cfg.enabled ? "checked" : ""}></div></div>
        <div class="form-group"><label>${t("CLOOT.Pick.DC")}</label>
          <div class="form-fields"><input type="number" name="dc" min="1" step="1" value="${cfg.customDc}" placeholder="${cfg.passive}"></div>
          <p class="hint">${game.i18n.format("CLOOT.Pick.DCHint", { passive: cfg.passive })}</p></div>`,
      ok: { label: t("CLOOT.Pick.Save"), callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      rejectClose: false
    });
    if (data) await this.act("pickSet", { enabled: data.enabled, dc: data.dc });
  }

  static async onPickGrant(event, target) {
    await this.act("pickGrant", { actorId: target.dataset.actor });
  }

  static async onPickItem(event, target) {
    await this.act("pickItem", { actorId: target.dataset.actor, itemId: target.closest("[data-item-id]")?.dataset.itemId });
  }

  static async onPickCoins(event, target) {
    await this.act("pickCoins", { actorId: target.dataset.actor });
  }

  static async onPickReset(event, target) {
    await this.act("pickReset", { actorId: target.dataset.actor });
  }

  static async onUnlock(event, target) {
    await this.act("harvestUnlock", { entryId: target.dataset.entry });
  }

  static async onGmRemove(event, target) {
    await this.act("gmRemove", { itemId: target.closest("[data-item-id]")?.dataset.itemId });
  }

  static async onOpenTable() {
    const doc = fromUuidSync(this.tokenUuid);
    await game.modules.get(MODULE_ID).api.editTable(doc?.baseActor ?? doc?.actor);
  }

  static async onRoll() {
    await this.act("roll");
  }

  static async onRefresh() {
    this.render();
  }
}
