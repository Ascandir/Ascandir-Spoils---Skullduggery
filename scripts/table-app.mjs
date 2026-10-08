import { MODULE_ID, LOOT_TYPES, normalizeTable, normalizeHarvest, rollTable } from "./rules.mjs";

const Base = dnd5e.applications.api.Application5e;
const ASSETS = `modules/${MODULE_ID}/assets`;
const COIN_ORDER = ["pp", "gp", "ep", "sp", "cp"];
const TABS = ["table", "harvest", "preview"];

/**
 * Ein Fenster für alles, was die Spielleitung pro NSC einstellt:
 * Reiter "Loottable" (Münzen, Munition, Zusatz-Items), "Ernte" (Proben für Tiere) und "Vorschau" (Testwurf).
 */
export class LootTableApp extends Base {
  constructor({ actor, tab = "table", ...options }) {
    const screenH = typeof window !== "undefined" ? window.innerHeight : 900;
    super({ id: `${MODULE_ID}-table-${actor.id}`, position: { height: Math.min(780, Math.round(screenH * 0.88)) }, ...options });
    this.tableActor = actor;
    this.tab = TABS.includes(tab) ? tab : "table";
    this.previewResult = null;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["corpse-loot", "corpse-loot-table"],
    tag: "form",
    position: { width: 960, height: "auto" },
    window: { icon: "fa-solid fa-sack-dollar", resizable: true },
    form: { handler: LootTableApp.onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      remove: LootTableApp.onRemove,
      preview: LootTableApp.onPreview,
      showPage: LootTableApp.onShowPage,
      save: LootTableApp.onSave,
      addEntry: LootTableApp.onAddEntry,
      removeEntry: LootTableApp.onRemoveEntry,
      removeItem: LootTableApp.onRemoveItem
    }
  };

  /** @override */
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/table.hbs` }
  };

  /** @override */
  get title() {
    return game.i18n.format("CLOOT.Table.Title", { name: this.tableActor?.name ?? "" });
  }

  get table() {
    return normalizeTable(this.tableActor.getFlag(MODULE_ID, "table") ?? {});
  }

  get entries() {
    return normalizeHarvest(this.tableActor.getFlag(MODULE_ID, "harvest") ?? []);
  }

  /** Wechselt die Seite im selben Fenster. */
  showTab(tab) {
    this.tab = TABS.includes(tab) ? tab : "table";
    return this.render();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const table = this.table;
    const rows = table.items.map((it, idx) => ({ ...it, idx }));
    // Elektrum gibt es in den neuen Regeln nicht mehr: nur zeigen, wenn es schon eingestellt ist
    const keys = COIN_ORDER.filter((k) => k !== "ep" || table.coins.ep.max > 0);
    const skills = Object.entries(CONFIG.DND5E.skills)
      .map(([key, v]) => ({ key, label: v.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const entries = this.entries.map((e, idx) => ({
      ...e,
      idx,
      consumeOnSuccess: e.consumeOn !== "attempt",
      skills: skills.map((s) => ({ ...s, selected: s.key === e.skill })),
      items: e.items.map((it, j) => ({ ...it, j }))
    }));
    return {
      ...context,
      assets: ASSETS,
      banner: this.tab === "harvest" ? "banner-harvest.svg" : "banner.svg",
      name: this.tableActor.name,
      table,
      isTable: this.tab === "table",
      isHarvest: this.tab === "harvest",
      isPreview: this.tab === "preview",
      coins: keys.map((key) => ({ key, label: game.i18n.localize(`CLOOT.Cfg.Coin.${key}`), ...table.coins[key] })),
      rangeRows: rows.filter((r) => r.kind === "range"),
      specialRows: rows.filter((r) => r.kind === "special"),
      preview: this.previewResult,
      entries,
      hasEntries: entries.length > 0
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const bind = (selector, handler) => {
      for (const zone of this.element.querySelectorAll(selector)) {
        zone.addEventListener("dragenter", () => zone.classList.add("dragover"));
        zone.addEventListener("dragleave", (ev) => {
          if (!zone.contains(ev.relatedTarget)) zone.classList.remove("dragover");
        });
        zone.addEventListener("dragover", (ev) => ev.preventDefault());
        zone.addEventListener("drop", (ev) => {
          zone.classList.remove("dragover");
          handler(ev, zone);
        });
      }
    };
    bind("[data-drop-kind]", (ev, zone) => this.onDropItem(ev, zone.dataset.dropKind));
    bind("[data-entry]", (ev, zone) => this.onDropHarvest(ev, Number(zone.dataset.entry)));
  }

  async save(table) {
    await this.tableActor.update({ [`flags.${MODULE_ID}.table`]: table });
  }

  async saveHarvest(entries) {
    // Foundry ersetzt Listen beim Speichern komplett, gelöschte Stufen sind danach wirklich weg
    await this.tableActor.update({ [`flags.${MODULE_ID}.harvest`]: entries });
  }

  /** Liest einen aus Seitenleiste, Kompendium oder Bogen gezogenen Gegenstand. */
  async readDroppedItem(event) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return null;
    }
    if (data?.type !== "Item" || !data.uuid) return null;
    const item = await fromUuid(data.uuid);
    if (!item) return null;
    if (!LOOT_TYPES.includes(item.type)) {
      ui.notifications.warn(game.i18n.localize("CLOOT.Table.NotAnItem"));
      return null;
    }
    return item;
  }

  /** Loottable: Gegenstand aufs Munitions- bzw. Zusatz-Items-Feld ziehen. */
  async onDropItem(event, kind) {
    const item = await this.readDroppedItem(event);
    if (!item) return;
    const table = this.table;
    table.items.push({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      kind,
      min: 1,
      max: 1,
      chance: kind === "special" ? 25 : 100
    });
    await this.save(table);
    this.render();
  }

  /** Ernte: Gegenstand als Ertrag einer Stufe ablegen. */
  async onDropHarvest(event, idx) {
    const item = await this.readDroppedItem(event);
    if (!item) return;
    const entries = this.entries;
    if (!entries[idx]) return;
    entries[idx].items.push({ uuid: item.uuid, name: item.name, img: item.img, min: 1, max: 1 });
    await this.saveHarvest(entries);
    this.render();
  }

  /** Es existieren immer nur die Felder der gerade offenen Seite, darum speichern wir auch nur diese. */
  static async onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if (this.tab === "table") await this.save(normalizeTable(data));
    else if (this.tab === "harvest") await this.saveHarvest(normalizeHarvest(data.entries ?? []));
  }

  static async onRemove(event, target) {
    const table = this.table;
    table.items.splice(Number(target.dataset.idx), 1);
    await this.save(table);
    this.render();
  }

  /**
   * Seitenwechsel. Der Name ist bewusst NICHT "tab": Diese Aktion gehört Foundrys eingebautem Reitersystem
   * (ApplicationV2 fängt data-action="tab" selbst ab) und unser Handler würde nie aufgerufen.
   */
  static async onShowPage(event, target) {
    await this.showTab(target.dataset.page);
  }

  /** Alle Änderungen werden schon beim Eintippen gespeichert. Der Knopf bestätigt das. */
  static async onSave() {
    ui.notifications.info(game.i18n.localize(this.tab === "harvest" ? "CLOOT.Cfg.SavedHarvest" : "CLOOT.Cfg.Saved"));
  }

  static async onAddEntry() {
    const entries = this.entries;
    entries.push(
      ...normalizeHarvest([{ label: game.i18n.localize("CLOOT.Harvest.NewEntry"), skill: "sur", dc: 10, tries: 1, items: [] }])
    );
    await this.saveHarvest(entries);
    this.render();
  }

  static async onRemoveEntry(event, target) {
    const entries = this.entries;
    entries.splice(Number(target.dataset.idx), 1);
    await this.saveHarvest(entries);
    this.render();
  }

  static async onRemoveItem(event, target) {
    const entries = this.entries;
    entries[Number(target.dataset.idx)]?.items.splice(Number(target.dataset.j), 1);
    await this.saveHarvest(entries);
    this.render();
  }

  /** Testwurf: zeigt in der Vorschau, was ein Token mit dieser Tabelle bekäme. Verändert nichts. */
  static async onPreview() {
    const result = rollTable(this.table);
    const coins = COIN_ORDER.filter((k) => result.coins[k]).map((key) => ({
      key,
      label: game.i18n.localize(`CLOOT.Cfg.Coin.${key}`),
      value: result.coins[key]
    }));
    const items = result.items.map((it) => ({ name: it.name, img: it.img, qty: it.qty }));
    this.previewResult = { coins, items, empty: !coins.length && !items.length };
    await this.showTab("preview");
  }
}
