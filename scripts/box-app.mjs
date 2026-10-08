import { MODULE_ID, normalizeLock } from "./rules.mjs";
import * as Service from "./service.mjs";

const Base = dnd5e.applications.api.Application5e;
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * Schloss-Einstellungen eines Containers (nur Spielleitung): zugesperrt ja/nein, SG, Versuche pro Charakter,
 * Diebeswerkzeug, Schlüssel. Ohne Token gelten sie für die Vorlage (alle künftig platzierten Token).
 */
export class BoxLockApp extends Base {
  constructor({ token = null, actor, ...options }) {
    super({ id: `${MODULE_ID}-boxlock-${token?.uuid?.replaceAll(".", "-") ?? `proto-${actor.id}`}`, ...options });
    this.token = token;
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["corpse-loot", "cl-dialog", "cl-thievery", "cl-boxlock"],
    position: { width: 520, height: "auto" },
    window: { icon: "fa-solid fa-lock", resizable: false },
    actions: { save: BoxLockApp.onSave, resetTries: BoxLockApp.onResetTries }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/box-lock.hbs` } };

  get title() {
    return t("CLOOT.Box.Title", { name: this.token?.name ?? this.actor.name });
  }

  get flags() {
    return (this.token ? this.token.flags?.[MODULE_ID] : this.actor.prototypeToken?.flags?.[MODULE_ID]) ?? {};
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const lock = normalizeLock(this.flags.lock);
    return {
      ...context,
      isToken: Boolean(this.token),
      locked: Boolean(this.flags.boxLocked),
      lock,
      hasAttempts: Object.keys(this.flags.attempts ?? {}).length > 0
    };
  }

  async write(data) {
    if (this.token) await this.token.update(data);
    else {
      const proto = {};
      for (const [k, v] of Object.entries(data)) proto[`prototypeToken.${k}`] = v;
      await this.actor.update(proto);
    }
    if (this.token) Service.notifyChanged(this.token.uuid);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const name = this.element.querySelector("[name=keyName]");
    const uuid = this.element.querySelector("[name=keyUuid]");
    if (!name || !uuid) return;
    name.addEventListener("dragover", (ev) => ev.preventDefault());
    name.addEventListener("drop", async (ev) => {
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
      name.value = item.name;
      uuid.value = data.uuid;
    });
    name.addEventListener("input", () => (uuid.value = ""));
  }

  static async onSave() {
    const q = (n) => this.element.querySelector(`[name=${n}]`);
    const num = (n) => {
      const v = Math.floor(Number(q(n)?.value));
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const f = `flags.${MODULE_ID}`;
    await this.write({
      [`${f}.boxLocked`]: Boolean(q("locked")?.checked),
      [`${f}.lock.dc`]: num("dc"),
      [`${f}.lock.maxTries`]: num("maxTries"),
      [`${f}.lock.needTool`]: Boolean(q("needTool")?.checked),
      [`${f}.lock.keyName`]: String(q("keyName")?.value ?? "").trim(),
      [`${f}.lock.keyUuid`]: String(q("keyUuid")?.value ?? "").trim()
    });
    ui.notifications.info(t("CLOOT.Box.Saved"));
    this.render();
  }

  static async onResetTries() {
    await this.write({ [`flags.${MODULE_ID}.-=attempts`]: null });
    ui.notifications.info(t("CLOOT.Door.TriesReset"));
    this.render();
  }
}

export async function openBoxLock({ token = null, actor }) {
  if (!game.user.isGM) return;
  const a = actor ?? token?.baseActor ?? token?.actor;
  if (!a) return;
  const id = `${MODULE_ID}-boxlock-${token?.uuid?.replaceAll(".", "-") ?? `proto-${a.id}`}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) {
    existing.render({ force: true });
    existing.bringToFront?.();
    return;
  }
  new BoxLockApp({ token, actor: a }).render({ force: true });
}
