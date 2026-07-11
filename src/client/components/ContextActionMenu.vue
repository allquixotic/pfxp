<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  watch,
} from 'vue';
import { useQuasar, type QDialog, type QMenu } from 'quasar';

import type { ContextMenuAction, ContextMenuTrigger } from './context-menu-model';

const props = withDefaults(defineProps<{
  title: string;
  subtitle?: string;
  actions: ContextMenuAction[];
  target?: boolean | string | Element;
}>(), {
  subtitle: '',
  target: undefined,
});

const emit = defineEmits<{
  select: [id: string];
}>();

const $q = useQuasar();
const anchor = ref<HTMLElement | null>(null);
const desktopMenu = ref<QMenu | null>(null);
const mobileDialog = ref<QDialog | null>(null);
const desktopOpen = ref(false);
const mobileOpen = ref(false);
const activeParentId = ref<string | null>(null);
const rovingIndex = ref(0);
const menuLabelId = `context-action-menu-${useId().replace(/:/g, '')}`;

const resolvedTarget = computed<boolean | string | Element>(() => (
  props.target ?? anchor.value ?? false
));
const activeParent = computed(() => (
  activeParentId.value
    ? props.actions.find((action) => action.id === activeParentId.value) ?? null
    : null
));
const currentActions = computed(() => activeParent.value?.children ?? props.actions);
const currentTitle = computed(() => activeParent.value?.label ?? props.title);
const currentSubtitle = computed(() => activeParent.value?.caption ?? props.subtitle);
const isOpen = computed(() => desktopOpen.value || mobileOpen.value);

let returnFocus: HTMLElement | null = null;
let fallbackFocus: HTMLElement | null = null;
let shouldRestoreFocus = true;
let listenersAttached = false;
let openSequence = 0;

interface QuasarDismissEvent extends Event {
  qClickOutside?: boolean;
}

function popupContent(): Element | null {
  return mobileOpen.value
    ? mobileDialog.value?.contentEl ?? null
    : desktopMenu.value?.contentEl ?? null;
}

function enabledActionElements(): HTMLElement[] {
  const content = popupContent();
  if (!content) return [];

  return Array.from(content.querySelectorAll<HTMLElement>(
    '[data-context-menu-action]:not([aria-disabled="true"])',
  ));
}

function firstEnabledIndex(actions = currentActions.value): number {
  const index = actions.findIndex((action) => !action.disabled);
  return index < 0 ? 0 : index;
}

function focusAction(index: number): void {
  const elements = enabledActionElements();
  if (!elements.length) return;

  const wrappedIndex = (index + elements.length) % elements.length;
  const actionId = elements[wrappedIndex]?.dataset.contextMenuAction;
  const actionIndex = currentActions.value.findIndex((action) => action.id === actionId);
  rovingIndex.value = actionIndex >= 0 ? actionIndex : firstEnabledIndex();
  elements[wrappedIndex]?.focus({ preventScroll: true });
}

function focusFirstAction(): void {
  rovingIndex.value = firstEnabledIndex();
  void nextTick(() => {
    requestAnimationFrame(() => focusAction(0));
  });
}

function focusActionById(id: string): void {
  void nextTick(() => {
    const elements = enabledActionElements();
    const index = elements.findIndex((element) => element.dataset.contextMenuAction === id);
    focusAction(index >= 0 ? index : 0);
    desktopMenu.value?.updatePosition();
  });
}

function enterChildren(action: ContextMenuAction): void {
  if (activeParentId.value || !action.children?.length || action.disabled) return;
  activeParentId.value = action.id;
  focusFirstAction();
  void nextTick(() => desktopMenu.value?.updatePosition());
}

function leaveChildren(): void {
  const parentId = activeParentId.value;
  if (!parentId) return;
  activeParentId.value = null;
  focusActionById(parentId);
}

function activate(action: ContextMenuAction): void {
  if (action.disabled) return;

  if (!activeParentId.value && action.children?.length) {
    enterChildren(action);
    return;
  }

  emit('select', action.id);
  if (action.keepOpen) {
    focusActionById(action.id);
  } else {
    close();
  }
}

function onMenuKeydown(event: KeyboardEvent): void {
  const elements = enabledActionElements();
  const activeIndex = elements.findIndex((element) => element === document.activeElement);

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusAction(activeIndex + 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusAction(activeIndex <= 0 ? elements.length - 1 : activeIndex - 1);
      break;
    case 'Home':
      event.preventDefault();
      focusAction(0);
      break;
    case 'End':
      event.preventDefault();
      focusAction(elements.length - 1);
      break;
    case 'ArrowRight': {
      const actionId = elements[activeIndex]?.dataset.contextMenuAction;
      const action = currentActions.value.find((candidate) => candidate.id === actionId);
      if (!activeParentId.value && action?.children?.length) {
        event.preventDefault();
        enterChildren(action);
      }
      break;
    }
    case 'ArrowLeft':
      if (activeParentId.value) {
        event.preventDefault();
        event.stopPropagation();
        leaveChildren();
      }
      break;
    case 'Escape':
      if (activeParentId.value) {
        event.preventDefault();
        event.stopPropagation();
        leaveChildren();
      } else {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      break;
    case 'Tab':
      if (!mobileOpen.value) {
        event.preventDefault();
        close();
      }
      break;
  }
}

function pointEvent(
  event: Event,
  sourceElement: HTMLElement | null,
  trigger: ContextMenuTrigger,
): Event {
  if (trigger !== 'keyboard') {
    if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) return event;
    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) return event;
  }

  const rect = sourceElement?.getBoundingClientRect();
  const clientX = rect
    ? Math.min(window.innerWidth - 8, Math.max(8, rect.left + Math.min(24, rect.width / 2)))
    : window.innerWidth / 2;
  const clientY = rect
    ? Math.min(window.innerHeight - 8, Math.max(8, rect.top + Math.min(24, rect.height / 2)))
    : window.innerHeight / 2;

  return new MouseEvent('contextmenu', { clientX, clientY });
}

function focusableContextTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  return element.closest<HTMLElement>([
    '.ag-cell',
    '.ag-header-cell',
    '.q-item[tabindex]',
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[tabindex]',
  ].join(',')) ?? element;
}

function addViewportListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('scroll', onViewportScroll, true);
  window.addEventListener('resize', onViewportResize, { passive: true });
  window.visualViewport?.addEventListener('resize', onViewportResize, { passive: true });
}

function removeViewportListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  window.removeEventListener('scroll', onViewportScroll, true);
  window.removeEventListener('resize', onViewportResize);
  window.visualViewport?.removeEventListener('resize', onViewportResize);
}

function onViewportScroll(event: Event): void {
  const content = popupContent();
  if (content && event.target instanceof Node && content.contains(event.target)) return;
  closeInternal(false);
}

function onViewportResize(): void {
  if (desktopOpen.value) desktopMenu.value?.updatePosition();
}

function restoreTriggerFocus(): void {
  if (!shouldRestoreFocus) return;

  const target = returnFocus?.isConnected
    ? returnFocus
    : fallbackFocus?.isConnected
      ? fallbackFocus
      : null;
  if (!target) return;

  requestAnimationFrame(() => {
    if (target.isConnected) target.focus({ preventScroll: true });
  });
}

function onBeforeHide(event?: Event): void {
  if ((event as QuasarDismissEvent | undefined)?.qClickOutside === true) {
    shouldRestoreFocus = false;
  }
}

function onShown(): void {
  addViewportListeners();
  focusFirstAction();
}

function onHidden(): void {
  removeViewportListeners();
  restoreTriggerFocus();
  returnFocus = null;
  fallbackFocus = null;
  activeParentId.value = null;
}

function closeInternal(restore = true, event?: Event): void {
  shouldRestoreFocus = restore;
  desktopMenu.value?.hide(event);
  mobileDialog.value?.hide(event);
}

function close(): void {
  closeInternal(true);
}

function open(event: Event, trigger: ContextMenuTrigger = 'pointer'): void {
  const sequence = ++openSequence;
  if (event.cancelable) event.preventDefault();

  const activeElement = document.activeElement;
  const eventTarget = event.target instanceof HTMLElement ? event.target : null;
  const sourceElement = focusableContextTarget(trigger === 'keyboard'
    ? activeElement instanceof HTMLElement ? activeElement : eventTarget
    : eventTarget);
  returnFocus = sourceElement?.isConnected ? sourceElement : null;
  fallbackFocus = activeElement instanceof HTMLElement ? activeElement : null;
  shouldRestoreFocus = true;
  activeParentId.value = null;
  rovingIndex.value = firstEnabledIndex(props.actions);
  const positionedEvent = pointEvent(event, sourceElement, trigger);

  void (async () => {
    if (isOpen.value) {
      closeInternal(false, event);
      await nextTick();
    } else {
      await nextTick();
    }

    if (sequence !== openSequence) return;
    shouldRestoreFocus = true;
    if ($q.screen.lt.md) {
      mobileDialog.value?.show(positionedEvent);
    } else {
      desktopMenu.value?.show(positionedEvent);
    }
  })();
}

watch(currentActions, (actions) => {
  if (!isOpen.value) return;

  const activeId = (document.activeElement as HTMLElement | null)?.dataset?.contextMenuAction;
  const activeIndex = activeId ? actions.findIndex((action) => action.id === activeId) : -1;
  rovingIndex.value = activeIndex >= 0 && !actions[activeIndex]?.disabled
    ? activeIndex
    : firstEnabledIndex(actions);
  void nextTick(() => desktopMenu.value?.updatePosition());
});

watch(() => $q.screen.lt.md, () => {
  if (isOpen.value) closeInternal(false);
});

onBeforeUnmount(() => {
  openSequence += 1;
  shouldRestoreFocus = false;
  removeViewportListeners();
});

defineExpose({ open, close });
</script>

<template>
  <span ref="anchor" class="context-action-menu__anchor" aria-hidden="true" />

  <q-menu
    ref="desktopMenu"
    v-model="desktopOpen"
    :target="resolvedTarget"
    no-parent-event
    touch-position
    no-refocus
    :max-width="'calc(100vw - 16px)'"
    :max-height="'min(32rem, calc(100dvh - 16px))'"
    :transition-duration="120"
    class="context-action-menu context-action-menu--desktop"
    :aria-labelledby="menuLabelId"
    @before-hide="onBeforeHide"
    @show="onShown"
    @hide="onHidden"
    @keydown="onMenuKeydown"
  >
    <header class="context-action-menu__header">
      <q-btn
        v-if="activeParent"
        flat
        round
        dense
        icon="r_arrow_back"
        aria-label="Back to previous menu"
        @click="leaveChildren"
      />
      <div class="context-action-menu__heading">
        <strong :id="menuLabelId">{{ currentTitle }}</strong>
        <span v-if="currentSubtitle">{{ currentSubtitle }}</span>
      </div>
    </header>

    <q-list class="context-action-menu__list" role="none">
      <template v-for="(action, index) in currentActions" :key="action.id">
        <q-separator v-if="action.separatorBefore" role="separator" />
        <q-item
          clickable
          :disable="action.disabled"
          :tabindex="!action.disabled && index === rovingIndex ? 0 : -1"
          :role="action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
          :aria-checked="action.checked === undefined ? undefined : action.checked"
          :aria-disabled="action.disabled ? 'true' : undefined"
          :aria-haspopup="!activeParent && action.children?.length ? 'menu' : undefined"
          :data-context-menu-action="action.id"
          :data-autofocus="!action.disabled && index === rovingIndex ? '' : undefined"
          :class="[
            'context-action-menu__item',
            { 'context-action-menu__item--danger': action.danger },
          ]"
          @click="activate(action)"
        >
          <q-item-section avatar>
            <q-icon
              :name="action.checked !== undefined ? (action.checked ? 'r_check_box' : 'r_check_box_outline_blank') : (action.icon ?? 'r_circle')"
              :class="{ 'context-action-menu__placeholder-icon': !action.icon && action.checked === undefined }"
              size="20px"
            />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ action.label }}</q-item-label>
            <q-item-label v-if="action.caption" caption>{{ action.caption }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="!activeParent && action.children?.length" side>
            <q-icon name="r_chevron_right" size="20px" />
          </q-item-section>
        </q-item>
      </template>

      <div v-if="!currentActions.length" class="context-action-menu__empty">
        No actions available
      </div>
    </q-list>
  </q-menu>

  <q-dialog
    ref="mobileDialog"
    v-model="mobileOpen"
    position="bottom"
    no-refocus
    :transition-duration="160"
    @before-hide="onBeforeHide"
    @show="onShown"
    @hide="onHidden"
  >
    <q-card
      class="context-action-menu context-action-menu--mobile"
      :aria-labelledby="`${menuLabelId}-mobile`"
      @keydown="onMenuKeydown"
    >
      <header class="context-action-menu__header context-action-menu__header--mobile">
        <q-btn
          v-if="activeParent"
          flat
          round
          dense
          icon="r_arrow_back"
          aria-label="Back to previous menu"
          @click="leaveChildren"
        />
        <div class="context-action-menu__heading">
          <strong :id="`${menuLabelId}-mobile`">{{ currentTitle }}</strong>
          <span v-if="currentSubtitle">{{ currentSubtitle }}</span>
        </div>
        <q-btn flat round dense icon="r_close" aria-label="Close menu" @click="close" />
      </header>

      <q-list class="context-action-menu__list context-action-menu__list--mobile" role="menu">
        <template v-for="(action, index) in currentActions" :key="action.id">
          <q-separator v-if="action.separatorBefore" role="separator" />
          <q-item
            clickable
            :disable="action.disabled"
            :tabindex="!action.disabled && index === rovingIndex ? 0 : -1"
            :role="action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
            :aria-checked="action.checked === undefined ? undefined : action.checked"
            :aria-disabled="action.disabled ? 'true' : undefined"
            :aria-haspopup="!activeParent && action.children?.length ? 'menu' : undefined"
            :data-context-menu-action="action.id"
            :data-autofocus="!action.disabled && index === rovingIndex ? '' : undefined"
            :class="[
              'context-action-menu__item',
              'context-action-menu__item--mobile',
              { 'context-action-menu__item--danger': action.danger },
            ]"
            @click="activate(action)"
          >
            <q-item-section avatar>
              <q-icon
                :name="action.checked !== undefined ? (action.checked ? 'r_check_box' : 'r_check_box_outline_blank') : (action.icon ?? 'r_circle')"
                :class="{ 'context-action-menu__placeholder-icon': !action.icon && action.checked === undefined }"
                size="22px"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ action.label }}</q-item-label>
              <q-item-label v-if="action.caption" caption>{{ action.caption }}</q-item-label>
            </q-item-section>
            <q-item-section v-if="!activeParent && action.children?.length" side>
              <q-icon name="r_chevron_right" size="22px" />
            </q-item-section>
          </q-item>
        </template>

        <div v-if="!currentActions.length" class="context-action-menu__empty">
          No actions available
        </div>
      </q-list>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.context-action-menu__anchor {
  position: fixed;
  inset: 0 auto auto 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  pointer-events: none;
  clip-path: inset(50%);
}

.context-action-menu {
  color: var(--pfxp-text);
  background: var(--pfxp-surface);
  border: 1px solid var(--pfxp-border);
  box-shadow: var(--pfxp-shadow);
}

.context-action-menu--desktop {
  display: flex;
  flex-direction: column;
  width: min(21rem, calc(100vw - 16px));
  min-width: min(15rem, calc(100vw - 16px));
  max-height: min(32rem, calc(100dvh - 16px));
  border-radius: 10px;
}

.context-action-menu--mobile {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 46rem;
  max-height: min(78dvh, 44rem);
  margin: 0 auto;
  padding-bottom: env(safe-area-inset-bottom);
  border-width: 1px 1px 0;
  border-radius: 18px 18px 0 0;
}

.context-action-menu__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 54px;
  padding: 9px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--pfxp-border);
}

.context-action-menu__header--mobile {
  min-height: 62px;
  padding: 10px 14px;
}

.context-action-menu__heading {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.context-action-menu__heading strong,
.context-action-menu__heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-action-menu__heading strong {
  font-size: 14px;
  font-weight: 720;
  line-height: 1.35;
}

.context-action-menu__heading span {
  color: var(--pfxp-muted);
  font-size: 11px;
  line-height: 1.4;
}

.context-action-menu__list {
  flex: 1 1 auto;
  min-height: 0;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.context-action-menu__list--mobile {
  padding: 6px 8px 10px;
}

.context-action-menu__item {
  min-height: 42px;
  border-radius: 7px;
}

.context-action-menu__item--mobile {
  min-height: 52px;
  border-radius: 9px;
}

.context-action-menu__item :deep(.q-item__section--avatar) {
  min-width: 34px;
  color: var(--pfxp-muted);
}

.context-action-menu__item--danger,
.context-action-menu__item--danger :deep(.q-item__section--avatar) {
  color: var(--q-negative);
}

.context-action-menu__placeholder-icon {
  visibility: hidden;
}

.context-action-menu__empty {
  padding: 22px 16px;
  color: var(--pfxp-muted);
  font-size: 13px;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .context-action-menu {
    transition-duration: 0ms !important;
  }
}
</style>
