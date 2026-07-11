<script setup lang="ts">
import { computed, ref } from 'vue';
import { copyToClipboard, useQuasar } from 'quasar';

import {
  compactGameSystem,
  formatShortDate,
  scenarioDisplayName,
  type SessionDetail,
} from '../domain';
import { isAlreadyPlayedSessionNote } from '../../session-rules';
import ContextActionMenu from './ContextActionMenu.vue';
import type { ContextMenuAction } from './context-menu-model';

type MobileSort = 'date-desc' | 'date-asc' | 'xp-desc' | 'character';
type ContextMenuTrigger = 'pointer' | 'touch' | 'keyboard';

const props = withDefaults(defineProps<{
  rows: SessionDetail[];
  sort: MobileSort;
  hasFilters?: boolean;
  density?: 'compact' | 'comfortable';
}>(), {
  hasFilters: false,
  density: 'comfortable',
});

const emit = defineEmits<{
  select: [session: SessionDetail];
  filterCharacter: [session: SessionDetail];
  filterGame: [gameSystem: string];
  filterRole: [role: 'gm' | 'player'];
  updateSort: [sort: MobileSort];
  openFilters: [];
  clearFilters: [];
  export: [];
}>();

const $q = useQuasar();
const contextMenu = ref<{ open: (event: Event, trigger?: ContextMenuTrigger) => void; close: () => void }>();
const contextSession = ref<SessionDetail | null>(null);

const contextActions = computed<ContextMenuAction[]>(() => {
  const session = contextSession.value;
  const isGm = session?.prestigeReputation.isGM === 'yes';

  return [
    { id: 'session:open', label: 'View session details', icon: 'r_open_in_new' },
    {
      id: 'filter:character',
      label: 'Filter to this character',
      caption: session?.character.name || undefined,
      icon: 'r_person_search',
      disabled: !session?.character.name,
    },
    {
      id: 'filter:game',
      label: 'Filter to this game',
      caption: session?.gameSystem,
      icon: 'r_sports_esports',
      disabled: !session?.gameSystem,
    },
    {
      id: 'filter:role',
      label: `Filter to ${isGm ? 'GM' : 'player'} sessions`,
      icon: isGm ? 'r_stars' : 'r_account_circle',
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: 'r_content_copy',
      separatorBefore: true,
      children: [
        { id: 'copy:scenario', label: 'Scenario name', icon: 'r_menu_book', disabled: !session?.scenario },
        { id: 'copy:character', label: 'Character name', icon: 'r_person', disabled: !session?.character.name },
        { id: 'copy:event', label: 'Event ID', icon: 'r_tag', disabled: !session?.event.id },
        { id: 'copy:gm', label: 'GM name', icon: 'r_badge', disabled: !session?.gm },
      ],
    },
    {
      id: 'sort',
      label: 'Sort sessions',
      icon: 'r_sort',
      children: [
        { id: 'sort:date-desc', label: 'Newest first', icon: 'r_arrow_downward', checked: props.sort === 'date-desc' },
        { id: 'sort:date-asc', label: 'Oldest first', icon: 'r_arrow_upward', checked: props.sort === 'date-asc' },
        { id: 'sort:xp-desc', label: 'Most XP', icon: 'r_trending_up', checked: props.sort === 'xp-desc' },
        { id: 'sort:character', label: 'Character name', icon: 'r_sort_by_alpha', checked: props.sort === 'character' },
      ],
    },
    { id: 'filters:open', label: 'Open all filters', icon: 'r_tune', separatorBefore: true },
    { id: 'filters:clear', label: 'Clear active filters', icon: 'r_filter_alt_off', disabled: !props.hasFilters },
    { id: 'export', label: 'Export visible sessions', icon: 'r_download', separatorBefore: true },
  ];
});

function formatDate(value?: string) {
  if (props.density === 'compact') return formatShortDate(value) || 'Date unavailable';
  if (!value) return 'Date unavailable';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' }).format(parsed);
}

function displayScenario(value: string): string {
  return scenarioDisplayName(value);
}

function displayGame(value: string): string {
  return props.density === 'compact' ? compactGameSystem(value) : value;
}

function gameClass(system: string) {
  if (system.includes('Starfinder')) return 'pfxp-game--sf';
  if (system.includes('Pathfinder 1')) return 'pfxp-game--pf1';
  if (!system.includes('Pathfinder')) return 'pfxp-game--other';
  return '';
}

function openContext(event: Event, session: SessionDetail, trigger: ContextMenuTrigger) {
  event.preventDefault();
  event.stopPropagation();
  contextSession.value = session;
  contextMenu.value?.open(event, trigger);
}

function touchHandler(session: SessionDetail) {
  return ({ evt }: { evt: Event }) => openContext(evt, session, 'touch');
}

function onContextKey(event: KeyboardEvent, session: SessionDetail) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  openContext(event, session, 'keyboard');
}

async function copyValue(value: string | number | undefined | null, label: string) {
  if (value == null || String(value).length === 0) return;
  try {
    await copyToClipboard(String(value));
    $q.notify({ message: `${label} copied`, icon: 'r_content_copy', color: 'positive', timeout: 1800 });
  } catch {
    $q.notify({ message: `Could not copy ${label.toLocaleLowerCase()}.`, icon: 'r_error', color: 'negative' });
  }
}

function handleContextAction(id: string) {
  const session = contextSession.value;
  if (!session) return;

  if (id === 'session:open') emit('select', session);
  else if (id === 'filter:character') emit('filterCharacter', session);
  else if (id === 'filter:game') emit('filterGame', session.gameSystem);
  else if (id === 'filter:role') emit('filterRole', session.prestigeReputation.isGM === 'yes' ? 'gm' : 'player');
  else if (id === 'copy:scenario') void copyValue(displayScenario(session.scenario), 'Scenario');
  else if (id === 'copy:character') void copyValue(session.character.name, 'Character name');
  else if (id === 'copy:event') void copyValue(session.event.id, 'Event ID');
  else if (id === 'copy:gm') void copyValue(session.gm, 'GM name');
  else if (id.startsWith('sort:')) emit('updateSort', id.slice(5) as MobileSort);
  else if (id === 'filters:open') emit('openFilters');
  else if (id === 'filters:clear') emit('clearFilters');
  else if (id === 'export') emit('export');
}
</script>

<template>
  <div class="mobile-sessions">
    <q-virtual-scroll
      v-if="rows.length"
      class="mobile-sessions__scroll"
      :items="rows"
      :virtual-scroll-item-size="density === 'compact' ? 112 : 128"
      v-slot="{ item }"
      @scroll.passive="contextMenu?.close()"
    >
      <q-item
        :key="`${item.event.id}-${item.session}-${item.player.orgplayid}`"
        clickable
        v-ripple
        v-touch-hold:500:12="touchHandler(item)"
        class="mobile-session"
        :class="{
          'mobile-session--compact': density === 'compact',
          'mobile-session--already-played': isAlreadyPlayedSessionNote(item.notes),
        }"
        :aria-label="`${displayScenario(item.scenario) || 'Untitled session'}, ${item.character.name || 'unknown character'}. Open details or use long press for actions.`"
        @click="emit('select', item)"
        @contextmenu.prevent.stop="openContext($event, item, 'pointer')"
        @keydown="onContextKey($event, item)"
      >
        <q-item-section>
          <q-item-label caption class="mobile-session__date">{{ formatDate(item.date) }}</q-item-label>
          <q-item-label class="mobile-session__scenario" lines="2">{{ displayScenario(item.scenario) || 'Untitled session' }}</q-item-label>
          <div class="mobile-session__meta">
            <span><q-icon name="r_person" /> {{ item.character.name || `Character ${item.player.charid ?? '—'}` }}</span>
            <span :class="['pfxp-game', gameClass(item.gameSystem)]">{{ displayGame(item.gameSystem) }}</span>
          </div>
        </q-item-section>
        <q-item-section side class="mobile-session__side">
          <strong>{{ item.xp }} XP</strong>
          <span class="mobile-session__role">
            <q-icon :name="item.prestigeReputation.isGM === 'yes' ? 'r_stars' : 'r_account_circle'" />
            {{ item.prestigeReputation.isGM === 'yes' ? 'GM' : 'Player' }}
          </span>
          <q-icon name="r_chevron_right" size="24px" />
        </q-item-section>
      </q-item>
    </q-virtual-scroll>

    <div v-else class="mobile-sessions__empty">
      <q-icon name="r_search_off" size="34px" />
      <strong>No matching sessions</strong>
      <span>Try removing a filter or changing your search.</span>
    </div>

    <ContextActionMenu
      ref="contextMenu"
      title="Session actions"
      :subtitle="contextSession ? displayScenario(contextSession.scenario) : 'Untitled session'"
      :actions="contextActions"
      @select="handleContextAction"
    />
  </div>
</template>

<style scoped>
.mobile-sessions {
  height: 100%;
  min-height: 0;
  background: var(--pfxp-surface);
}

.mobile-sessions__scroll {
  height: 100%;
}

.mobile-session {
  min-height: 128px;
  padding: 14px;
  border-bottom: 1px solid var(--pfxp-border);
  -webkit-touch-callout: none;
}

.mobile-session--compact {
  min-height: 112px;
  padding-block: 10px;
}

.mobile-session--already-played {
  color: #6b7280;
  background: #eef1f4;
  filter: saturate(0.35);
}

:global(.body--dark) .mobile-session--already-played {
  color: #929cac;
  background: #1b2430;
}

.mobile-session:focus-visible {
  z-index: 1;
  outline: 3px solid color-mix(in srgb, var(--pfxp-primary) 46%, transparent);
  outline-offset: -3px;
}

.mobile-session__date {
  color: var(--pfxp-muted);
  font-size: 12px;
  font-weight: 550;
}

.mobile-session__scenario {
  margin: 3px 0 9px;
  color: var(--pfxp-text);
  font-size: 15px;
  font-weight: 720;
  line-height: 1.3;
}

.mobile-session__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  color: var(--pfxp-muted);
  font-size: 12px;
}

.mobile-session__meta > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.mobile-session__side {
  min-width: 74px;
  align-items: flex-end;
  justify-content: space-between;
  padding-left: 8px;
}

.mobile-session__side strong {
  color: var(--pfxp-primary);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.mobile-session__role {
  display: inline-flex;
  align-items: center;
  color: var(--pfxp-success);
  gap: 4px;
  font-size: 12px;
}

.mobile-sessions__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 36px;
  color: var(--pfxp-muted);
  gap: 8px;
  text-align: center;
}

.mobile-sessions__empty strong {
  color: var(--pfxp-text);
  font-size: 15px;
}
</style>
