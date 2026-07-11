<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { copyToClipboard, useQuasar } from 'quasar';

import ContextActionMenu from './ContextActionMenu.vue';
import type { ContextMenuAction, ContextMenuTrigger } from './context-menu-model';

export interface CharacterSummaryView {
  key: string;
  name: string;
  gameSystem: string;
  totalXp: number;
  effectiveLevel: number | string;
  sessionCount: number;
  lastPlayed?: string;
  orgplayid?: number;
  charid?: number | null;
}

const props = withDefaults(defineProps<{
  rows: CharacterSummaryView[];
  dark?: boolean;
  density?: 'compact' | 'comfortable';
}>(), {
  dark: false,
  density: 'comfortable',
});

const emit = defineEmits<{ select: [row: CharacterSummaryView] }>();
const CharacterGrid = defineAsyncComponent(() => import('./CharacterGrid.vue'));
const $q = useQuasar();
const query = ref<string | null>('');
const normalizedQuery = computed(() => (query.value ?? '').trim());
type MobileCharacterSort = 'xp-desc' | 'name' | 'recent' | 'level' | 'sessions';
const mobileSort = ref<MobileCharacterSort>('xp-desc');
const contextRow = ref<CharacterSummaryView | null>(null);
const contextMenu = ref<{ open: (event: Event, trigger?: ContextMenuTrigger) => void; close: () => void }>();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastPlayed(value?: string): string {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : '—';
}

const filtered = computed(() => {
  const needle = normalizedQuery.value.toLocaleLowerCase();
  if (!needle) return props.rows;

  return props.rows.filter((row) => [
    row.name,
    row.gameSystem,
    row.orgplayid,
    row.charid,
    row.totalXp,
    row.effectiveLevel,
    row.sessionCount,
    row.lastPlayed,
    formatLastPlayed(row.lastPlayed),
  ].join(' ').toLocaleLowerCase().includes(needle));
});

const mobileRows = computed(() => {
  const rows = [...filtered.value];
  switch (mobileSort.value) {
    case 'name':
      return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    case 'recent':
      return rows.sort((a, b) => (parseDate(b.lastPlayed)?.getTime() ?? 0) - (parseDate(a.lastPlayed)?.getTime() ?? 0));
    case 'level':
      return rows.sort((a, b) => Number(b.effectiveLevel || 0) - Number(a.effectiveLevel || 0) || b.totalXp - a.totalXp);
    case 'sessions':
      return rows.sort((a, b) => b.sessionCount - a.sessionCount || b.totalXp - a.totalXp);
    default:
      return rows.sort((a, b) => b.totalXp - a.totalXp || a.name.localeCompare(b.name));
  }
});

const contextActions = computed<ContextMenuAction[]>(() => {
  const row = contextRow.value;
  const ids = row ? `${row.orgplayid ?? '—'}-${row.charid ?? 'GM'}` : '';
  return [
    { id: 'character:open', label: 'View this character’s sessions', icon: 'r_open_in_new' },
    {
      id: 'copy',
      label: 'Copy',
      icon: 'r_content_copy',
      separatorBefore: true,
      children: [
        { id: 'copy:name', label: 'Character name', icon: 'r_person', disabled: !row?.name },
        { id: 'copy:ids', label: 'Organized Play IDs', caption: ids || undefined, icon: 'r_tag', disabled: !row },
        { id: 'copy:game', label: 'Game system', icon: 'r_sports_esports', disabled: !row?.gameSystem },
      ],
    },
    {
      id: 'sort',
      label: 'Sort characters',
      icon: 'r_sort',
      separatorBefore: true,
      children: [
        { id: 'sort:xp-desc', label: 'Highest XP', icon: 'r_trending_up', checked: mobileSort.value === 'xp-desc' },
        { id: 'sort:name', label: 'Character name', icon: 'r_sort_by_alpha', checked: mobileSort.value === 'name' },
        { id: 'sort:recent', label: 'Recently played', icon: 'r_event', checked: mobileSort.value === 'recent' },
        { id: 'sort:level', label: 'Highest level', icon: 'r_military_tech', checked: mobileSort.value === 'level' },
        { id: 'sort:sessions', label: 'Most sessions', icon: 'r_format_list_numbered', checked: mobileSort.value === 'sessions' },
      ],
    },
  ];
});

function openContext(event: Event, row: CharacterSummaryView, trigger: ContextMenuTrigger) {
  event.preventDefault();
  event.stopPropagation();
  contextRow.value = row;
  contextMenu.value?.open(event, trigger);
}

function touchHandler(row: CharacterSummaryView) {
  return ({ evt }: { evt: Event }) => openContext(evt, row, 'touch');
}

function onContextKey(event: KeyboardEvent, row: CharacterSummaryView) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  openContext(event, row, 'keyboard');
}

async function copyValue(value: string, label: string) {
  if (!value) return;
  try {
    await copyToClipboard(value);
    $q.notify({ message: `${label} copied`, icon: 'r_content_copy', color: 'positive', timeout: 1800 });
  } catch {
    $q.notify({ message: `Could not copy ${label.toLocaleLowerCase()}.`, icon: 'r_error', color: 'negative' });
  }
}

function handleContextAction(id: string) {
  const row = contextRow.value;
  if (!row) return;
  if (id === 'character:open') emit('select', row);
  else if (id === 'copy:name') void copyValue(row.name, 'Character name');
  else if (id === 'copy:ids') void copyValue(`${row.orgplayid ?? '—'}-${row.charid ?? 'GM'}`, 'Organized Play IDs');
  else if (id === 'copy:game') void copyValue(row.gameSystem, 'Game system');
  else if (id.startsWith('sort:')) mobileSort.value = id.slice(5) as MobileCharacterSort;
}
</script>

<template>
  <section
    class="characters"
    :class="{ 'characters--dark': dark }"
    aria-labelledby="characters-heading"
  >
    <header class="characters__toolbar">
      <div>
        <h2 id="characters-heading">Characters</h2>
        <p>{{ rows.length }} characters · XP and effective level across the active run.</p>
      </div>
      <q-input
        v-model="query"
        outlined
        dense
        clearable
        debounce="120"
        placeholder="Search name, system, IDs, XP, level…"
        aria-label="Search characters"
        class="characters__search"
      >
        <template #prepend><q-icon name="r_search" /></template>
      </q-input>
    </header>

    <Suspense v-if="!$q.screen.lt.md">
      <CharacterGrid
        class="characters__grid"
        :rows="rows"
        :query="normalizedQuery"
        :dark="dark"
        :density="density"
        @select="emit('select', $event)"
      />
      <template #fallback>
        <div class="characters__loading" aria-label="Loading character table">
          <q-spinner color="primary" size="28px" />
        </div>
      </template>
    </Suspense>

    <q-virtual-scroll
      v-else
      class="characters__mobile"
      :items="mobileRows"
      :virtual-scroll-item-size="88"
      v-slot="{ item }"
      @scroll.passive="contextMenu?.close()"
    >
      <q-item
        clickable
        v-ripple
        v-touch-hold:500:12="touchHandler(item)"
        class="characters__mobile-row"
        :aria-label="`${item.name}, ${item.totalXp} XP. Open sessions or use long press for actions.`"
        @click="emit('select', item)"
        @contextmenu.prevent.stop="openContext($event, item, 'pointer')"
        @keydown="onContextKey($event, item)"
      >
        <q-item-section>
          <q-item-label class="text-weight-bold">{{ item.name }}</q-item-label>
          <q-item-label caption>{{ item.gameSystem }} · {{ item.sessionCount }} sessions</q-item-label>
          <q-item-label caption>Last played {{ formatLastPlayed(item.lastPlayed) }}</q-item-label>
        </q-item-section>
        <q-item-section side class="characters__mobile-xp">
          <strong>{{ item.totalXp }} XP</strong>
          <span>Level {{ item.effectiveLevel }}</span>
          <q-icon name="r_chevron_right" />
        </q-item-section>
      </q-item>
    </q-virtual-scroll>

    <ContextActionMenu
      ref="contextMenu"
      title="Character actions"
      :subtitle="contextRow?.name"
      :actions="contextActions"
      @select="handleContextAction"
    />
  </section>
</template>

<style scoped>
.characters {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--pfxp-surface);
}

.characters__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 84px;
  padding: 14px 20px;
  gap: 18px;
  border-bottom: 1px solid var(--pfxp-border);
}

.characters__toolbar h2 {
  margin: 0;
  color: var(--pfxp-text);
  font-size: 19px;
  font-weight: 750;
}

.characters__toolbar p {
  margin: 3px 0 0;
  color: var(--pfxp-muted);
  font-size: 12px;
}

.characters__search {
  width: min(430px, 48vw);
}

.characters__grid,
.characters__loading {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 20rem;
}

.characters__loading {
  display: grid;
  place-items: center;
}

.characters__mobile {
  flex: 1 1 auto;
  min-height: 0;
}

.characters__mobile-row {
  width: 100%;
  min-height: 88px;
  border-bottom: 1px solid var(--pfxp-border);
  -webkit-touch-callout: none;
}

.characters__mobile-row:focus-visible {
  z-index: 1;
  outline: 3px solid color-mix(in srgb, var(--pfxp-primary) 46%, transparent);
  outline-offset: -3px;
}

.characters__mobile-xp {
  align-items: flex-end;
  color: var(--pfxp-muted);
  font-size: 11px;
}

.characters__mobile-xp strong {
  color: var(--pfxp-primary);
  font-size: 14px;
}

@media (max-width: 1023px) {
  .characters__toolbar {
    flex-direction: column;
    align-items: stretch;
    min-height: auto;
    padding: 12px 14px;
  }

  .characters__toolbar > div {
    display: none;
  }

  .characters__search {
    width: 100%;
  }
}
</style>
