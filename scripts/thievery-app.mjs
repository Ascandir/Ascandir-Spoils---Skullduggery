import { MODULE_ID, pickpocketAllowed } from "./rules.mjs";
import * as Service from "./service.mjs";

const Base = dnd5e.applications.api.Application5e;
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * Einstellungen zum Taschendiebstahl eines Tokens (nur Spielleitung): erlauben/aus/Standard, eigener SG
 * und die Liste der Diebe mit Zurücksetzen. Ohne Token (aus dem Actor-Bogen ohne platzierten Token)
 * gelten die Einstellungen für die Vorlage, also für alle künftig platzierten Token.
 */
export class ThieveryApp extends Base {
  /** @param {{ token?: TokenDocument|null, actor: Actor }} options */
  constructor({ token = null, actor, ...options }) {
    super({ id: `${MODULE_ID}-thievery-${token?.uuid?.replaceAll(".", "-") ?? `proto-${actor.id}`}`, ...options });
    this.token = token;
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["corpse-loot", "cl-dialog", "cl-thievery"],
    position: { width: 520, height: "auto" },
    window: { icon: "fa-solid fa-hand-holding", resizable: false },
    actions: {
      save: ThieveryApp.onSave,
      reset: ThieveryApp.onReset,
      resetAll: ThieveryApp.onResetAll
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/thievery.hbs` }
  };

  /** @override */
  get title() {
    return t("CLOOT.Thief.Title", { name: this.token?.name ?? this.actor.name });
  }

  /** Gespeicherte Einstellung (Token oder Vorlage). */
  get cfg() {
    if (this.token) return this.token.getFlag(MODULE_ID, "pick") ?? {};
    return this.actor.prototypeToken?.flags?.[MODULE_ID]?.pick ?? {};
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cfg = this.cfg;
    const mode = typeof cfg.enabled === "boolean" ? (cfg.enabled ? "on" : "off") : "default";
    const thieves = Object.entries(cfg.thieves ?? {}).map(([id, v]) => ({
      id,
      name: game.actors.get(id)?.name ?? "?",
      success: v?.status === "success",
      failed: v?.status === "failed"
    }));
    return {
      ...context,
      isToken: Boolean(this.token),
      targetName: this.token?.name ?? this.actor.name,
      mode,
      modes: [
        { value: "default", label: t("CLOOT.Thief.ModeDefault"), selected: mode === "default" },
        { value: "on", label: t("CLOOT.Thief.ModeOn"), selected: mode === "on" },
        { value: "off", label: t("CLOOT.Thief.ModeOff"), selected: mode === "off" }
      ],
      worldAllowed: Boolean(game.settings.get(MODULE_ID, "pickpocket")),
      dc: cfg.dc ?? "",
      passive: Number(this.actor?.system?.skills?.prc?.passive) || 10,
      thieves,
      hasThieves: thieves.length > 0
    };
  }

  async writeFlags(data) {
    if (this.token) await this.token.update(data);
    else {
      const proto = {};
      for (const [k, v] of Object.entries(data)) proto[`prototypeToken.${k}`] = v;
      await this.actor.update(proto);
    }
  }

  changed() {
    if (this.token) Service.notifyChanged(this.token.uuid);
  }

  static async onSave() {
    const root = this.element;
    const mode = root.querySelector("[name=mode]")?.value ?? "default";
    const dc = Math.floor(Number(root.querySelector("[name=dc]")?.value));
    const enabled = mode === "on" ? true : mode === "off" ? false : null;
    await this.writeFlags({
      [`flags.${MODULE_ID}.pick.enabled`]: enabled,
      [`flags.${MODULE_ID}.pick.dc`]: Number.isFinite(dc) && dc > 0 ? dc : null
    });
    this.changed();
    ui.notifications.info(t("CLOOT.Thief.Saved"));
    this.render();
  }

  static async onReset(event, target) {
    if (!this.token) return;
    await this.writeFlags({ [`flags.${MODULE_ID}.pick.thieves.-=${target.dataset.actor}`]: null });
    this.changed();
    this.render();
  }

  static async onResetAll() {
    if (!this.token) return;
    await this.writeFlags({ [`flags.${MODULE_ID}.pick.-=thieves`]: null });
    this.changed();
    this.render();
  }
}

/** Öffnet das Thievery-Fenster für einen Token oder, ohne Token, für die Vorlage des Actors. */
export async function openThievery({ token = null, actor }) {
  if (!game.user.isGM) return;
  const a = actor ?? token?.actor ?? token?.baseActor;
  if (!a) {
    ui.notifications.warn(t("CLOOT.Err.NoCorpse"));
    return;
  }
  const id = `${MODULE_ID}-thievery-${token?.uuid?.replaceAll(".", "-") ?? `proto-${a.id}`}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) {
    existing.render({ force: true });
    existing.bringToFront?.();
    return;
  }
  new ThieveryApp({ token, actor: a }).render({ force: true });
}

export { pickpocketAllowed };
