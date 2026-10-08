import { MODULE_ID, CONTAINER_TYPE, COINS, isLootableItem, buildItemView } from "./rules.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Daten des Container-Actors: Beschreibung und Münzen (gleiche Pfade wie bei dnd5e, damit das Plündern sie lesen kann). */
class ContainerData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    const coin = () => new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 });
    return {
      style: new f.StringField({ required: true, blank: false, choices: ["chest", "sack"], initial: "chest" }),
      description: new f.HTMLField({ required: false, blank: true }),
      currency: new f.SchemaField(Object.fromEntries(COINS.map((k) => [k, coin()])))
    };
  }
}

/** Wird beim Start (init) aufgerufen: Typ, Datenmodell, Beschriftung und Bogen anmelden. */
export function registerContainer() {
  CONFIG.Actor.dataModels[CONTAINER_TYPE] = ContainerData;
  CONFIG.Actor.typeLabels = { ...(CONFIG.Actor.typeLabels ?? {}), [CONTAINER_TYPE]: "CLOOT.Container.Type" };
  CONFIG.Actor.typeIcons = { ...(CONFIG.Actor.typeIcons ?? {}), [CONTAINER_TYPE]: "fa-solid fa-box-archive" };

  const sheets = foundry.applications.sheets;
  const Sheet = makeSheet(sheets.ActorSheetV2, foundry.applications.api.HandlebarsApplicationMixin);
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, Sheet, {
    types: [CONTAINER_TYPE],
    makeDefault: true,
    label: "CLOOT.Container.Sheet"
  });

  // Neue Container: Truhen-Bild, Token ist nicht mit dem Actor verknüpft (jeder Token würfelt eigene Beute)
  Hooks.on("preCreateActor", (actor) => {
    if (actor.type !== CONTAINER_TYPE) return;
    const img = "icons/containers/chest/chest-wooden-brown.webp";
    actor.updateSource({
      img: actor.img && !actor.img.includes("mystery-man") ? actor.img : img,
      prototypeToken: { actorLink: false, disposition: 0, displayName: 30, texture: { src: img }, flags: { [MODULE_ID]: { box: true, boxLocked: false } } }
    });
  });
}

function makeSheet(ActorSheetV2, HandlebarsApplicationMixin) {
  return class ContainerSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
      classes: ["corpse-loot", "cl-dialog", "cl-container"],
      position: { width: 560, height: 640 },
      window: { icon: "fa-solid fa-box-archive", resizable: true },
      form: { submitOnChange: true, closeOnSubmit: false },
      actions: {
        editImage: ContainerSheet.onEditImage,
        removeItem: ContainerSheet.onRemoveItem,
        editTable: ContainerSheet.onEditTable,
        editLock: ContainerSheet.onEditLock
      }
    };

    static PARTS = {
      body: { template: `modules/${MODULE_ID}/templates/container.hbs` }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const actor = this.document;
      const items = actor.items.filter((i) => isLootableItem(i, { nested: true })).map((i) => buildItemView(i, { isGM: true }));
      return {
        ...context,
        actor,
        isGM: game.user.isGM,
        editable: this.isEditable,
        system: actor.system,
        coins: COINS.map((k) => ({ key: k, value: actor.system.currency?.[k] ?? 0, label: t(`CLOOT.Cfg.Coin.${k}`) })),
        items,
        hasItems: items.length > 0,
        styles: [
          { value: "chest", label: t("CLOOT.Container.StyleChest"), selected: (actor.system.style ?? "chest") === "chest" },
          { value: "sack", label: t("CLOOT.Container.StyleSack"), selected: actor.system.style === "sack" }
        ],
        hasTable: Boolean(actor.getFlag(MODULE_ID, "table"))
      };
    }

    static async onEditImage() {
      const Picker = foundry.applications.apps.FilePicker.implementation;
      new Picker({ type: "image", current: this.document.img, callback: (path) => this.document.update({ img: path }) }).render({ force: true });
    }

    static async onRemoveItem(event, target) {
      await this.document.items.get(target.dataset.itemId)?.delete();
    }

    static async onEditTable() {
      await game.modules.get(MODULE_ID).api.editTable(this.document);
    }

    static async onEditLock() {
      const token = this.document.isToken ? this.document.token : null;
      await game.modules.get(MODULE_ID).api.editLock({ token, actor: this.document.isToken ? this.document.baseActor : this.document });
    }
  };
}
