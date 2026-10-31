/**
 * @module layers/entityCard
 *
 * Click-to-open card for layers whose map marks are Cesium entities.
 *
 * One controller per layer: it listens for a left click, asks the layer
 * whether the picked entity is one of its own, and shows that entity's card
 * through the overlay host's selected-card slot. Escape or a click on empty
 * globe closes the card. The layer owns the TEXT (it passes a `resolve`
 * function); this module owns the click, the pick ownership and the slot.
 *
 * Nothing here imports the app: the pick registry and the pointer-ownership
 * check arrive through `interaction`, so the module stays portable.
 */
import * as Cesium from 'cesium';

/** The overlay host slot options of a one-card source. */
export const ENTITY_CARD_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

/**
 * The overlay entry for one open card.
 *
 * @param {string} id Pick id of the entity the card belongs to.
 * @param {Cesium.Cartesian3} position Where the card is anchored.
 * @param {{title: string, details?: string[]}} copy The card text.
 * @param {string} accent CSS colour.
 * @returns {object|null}
 */
export function createEntityCardOverlayEntry(id, position, copy, accent) {
  if (!id || !position) return null;
  return {
    id,
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: copy.title,
    details: copy.details ?? [],
    accent,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/** The string id of a scene.pick() result, or null. */
export function pickedEntityId(picked) {
  const raw = picked?.id;
  if (typeof raw === 'string') return raw;
  if (typeof raw?.id === 'string') return raw.id;
  const primitive = picked?.primitive?.id;
  return typeof primitive === 'string' ? primitive : null;
}

/**
 * @param {object} options
 * @param {string} options.layerId Pick-owner id.
 * @param {object} options.overlayHost The shared overlay host.
 * @param {string} options.sourceId Overlay source id the card lives in.
 * @param {(id: string, click: {position: Cesium.Cartesian3|null}) =>
 *   ({title: string, details?: string[], accent: string,
 *     position?: Cesium.Cartesian3}|null)} options.resolve Card for a
 *   picked entity id, or null when the id is not this layer's.
 * @param {(id: string) => boolean} options.owns Whether the id is this
 *   layer's (so siblings leave the pick alone).
 * @param {(id: string) => void} [options.onSelect] Called with the opened id.
 * @param {() => void} [options.onClear] Called when the card closes.
 * @param {{registerPickOwner?: Function, unregisterPickOwner?: Function,
 *   isPointerFree?: () => boolean}} [options.interaction]
 */
export function createEntityCard({
  layerId,
  overlayHost,
  sourceId,
  resolve,
  owns,
  onSelect,
  onClear,
  interaction = {},
}) {
  const isFree = interaction.isPointerFree ?? (() => true);
  let handler = null;
  let selectedId = null;

  function clear() {
    const had = selectedId !== null;
    selectedId = null;
    overlayHost.clearSource(sourceId);
    if (had) onClear?.();
  }

  function select(id, click = { position: null }) {
    const copy = resolve(id, click);
    const entry = copy
      ? createEntityCardOverlayEntry(
          id,
          copy.position ?? click.position,
          copy,
          copy.accent,
        )
      : null;
    if (!entry) return false;
    selectedId = id;
    overlayHost.setEntries(sourceId, [entry], ENTITY_CARD_SOURCE_OPTIONS);
    onSelect?.(id);
    return true;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') clear();
  }

  return {
    get selectedId() {
      return selectedId;
    },
    select,
    clear,

    install(viewer) {
      if (handler || !viewer?.scene?.canvas) return;
      overlayHost.setVisible(sourceId, true);
      interaction.registerPickOwner?.(layerId, owns);
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click) => {
        // A pointer a tool has claimed is not an ambient selection.
        if (!isFree()) return;
        const id = pickedEntityId(viewer.scene.pick(click.position));
        if (id && owns(id)) {
          // Zones are lines: anchor their card where the click landed.
          const ground = viewer.camera?.pickEllipsoid?.(
            click.position,
            viewer.scene.globe?.ellipsoid,
          );
          if (select(id, { position: ground ?? null })) return;
        }
        clear();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      if (typeof document !== 'undefined')
        document.addEventListener('keydown', onKeyDown);
    },

    remove() {
      handler?.destroy();
      handler = null;
      if (typeof document !== 'undefined')
        document.removeEventListener('keydown', onKeyDown);
      interaction.unregisterPickOwner?.(layerId);
      clear();
      overlayHost.setVisible(sourceId, false);
    },
  };
}
