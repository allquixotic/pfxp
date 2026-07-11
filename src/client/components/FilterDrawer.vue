<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';

export type CombineMode = 'AND' | 'OR';
export type RoleFilter = 'all' | 'gm' | 'player';
export type DateRangeFilter = 'any' | '30d' | '12m' | 'year';

const props = defineProps<{
  modelValue: boolean;
  terms: string[];
  combine: CombineMode;
  game: string | null;
  character: string | null;
  role: RoleFilter;
  dateRange: DateRangeFilter;
  gameOptions: string[];
  characterOptions: string[];
  matchCount: number;
  floatingFilters: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:terms': [value: string[]];
  'update:combine': [value: CombineMode];
  'update:game': [value: string | null];
  'update:character': [value: string | null];
  'update:role': [value: RoleFilter];
  'update:dateRange': [value: DateRangeFilter];
  'update:floatingFilters': [value: boolean];
  reset: [];
}>();

const $q = useQuasar();
const position = computed(() => $q.screen.lt.md ? 'bottom' : 'right');
const filteredCharacterOptions = ref([...props.characterOptions]);

watch(() => props.characterOptions, (value) => {
  filteredCharacterOptions.value = [...value];
});

const roleOptions = [
  { label: 'All roles', value: 'all' },
  { label: 'GM sessions', value: 'gm' },
  { label: 'Player sessions', value: 'player' },
];

const dateOptions = [
  { label: 'Any time', value: 'any' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 12 months', value: '12m' },
  { label: 'This calendar year', value: 'year' },
];

function updateTerm(index: number, value: string | number | null) {
  const next = [...props.terms];
  next[index] = String(value ?? '');
  emit('update:terms', next);
}

function removeTerm(index: number) {
  emit('update:terms', props.terms.filter((_, itemIndex) => itemIndex !== index));
}

function moveTerm(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= props.terms.length) return;
  const next = [...props.terms];
  [next[index], next[target]] = [next[target]!, next[index]!];
  emit('update:terms', next);
}

function filterCharacters(value: string, update: (callback: () => void) => void) {
  update(() => {
    const needle = value.trim().toLocaleLowerCase();
    filteredCharacterOptions.value = needle
      ? props.characterOptions.filter((option) => option.toLocaleLowerCase().includes(needle))
      : [...props.characterOptions];
  });
}
</script>

<template>
  <q-dialog
    :model-value="modelValue"
    :position="position"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card :class="position === 'bottom' ? 'pfxp-bottom-sheet filter-sheet' : 'pfxp-side-sheet filter-sheet'">
      <header class="pfxp-sheet-header">
        <div class="col">
          <h2 class="pfxp-sheet-title">Refine sessions</h2>
          <div class="pfxp-sheet-subtitle">{{ matchCount }} {{ matchCount === 1 ? 'match' : 'matches' }}</div>
        </div>
        <q-btn flat round icon="r_close" aria-label="Close filters" @click="emit('update:modelValue', false)" />
      </header>

      <q-scroll-area class="filter-sheet__body">
        <section class="pfxp-sheet-section">
          <h3 class="pfxp-sheet-section__title">Search terms</h3>
          <q-btn-toggle
            :model-value="combine"
            spread
            no-caps
            unelevated
            toggle-color="primary"
            color="white"
            text-color="primary"
            :options="[{ label: 'AND', value: 'AND' }, { label: 'OR', value: 'OR' }]"
            class="filter-sheet__combine"
            @update:model-value="emit('update:combine', $event)"
          />

          <div v-for="(term, index) in terms" :key="index" class="filter-sheet__term">
            <div class="filter-sheet__move">
              <q-btn flat round dense icon="r_keyboard_arrow_up" :disable="index === 0" :aria-label="`Move term ${index + 1} up`" @click="moveTerm(index, -1)" />
              <q-btn flat round dense icon="r_keyboard_arrow_down" :disable="index === terms.length - 1" :aria-label="`Move term ${index + 1} down`" @click="moveTerm(index, 1)" />
            </div>
            <q-input
              :model-value="term"
              outlined
              dense
              placeholder="Search every field"
              class="col"
              @update:model-value="updateTerm(index, $event)"
            />
            <q-btn flat round icon="r_close" :aria-label="`Remove term ${index + 1}`" @click="removeTerm(index)" />
          </div>

          <q-btn
            flat
            no-caps
            color="primary"
            icon="r_add"
            label="Add term"
            :disable="terms.length >= 6"
            @click="emit('update:terms', [...terms, ''])"
          />
        </section>

        <section class="pfxp-sheet-section filter-sheet__facets">
          <h3 class="pfxp-sheet-section__title">Quick facets</h3>
          <q-select
            :model-value="game"
            outlined
            dense
            clearable
            options-dense
            label="Game system"
            :options="gameOptions"
            @update:model-value="emit('update:game', $event)"
          />
          <q-select
            :model-value="character"
            outlined
            dense
            clearable
            use-input
            input-debounce="0"
            options-dense
            label="Character"
            :options="filteredCharacterOptions"
            @filter="filterCharacters"
            @update:model-value="emit('update:character', $event)"
          />
          <q-select
            :model-value="role"
            outlined
            dense
            emit-value
            map-options
            options-dense
            label="GM or player"
            :options="roleOptions"
            @update:model-value="emit('update:role', $event)"
          />
          <q-select
            :model-value="dateRange"
            outlined
            dense
            emit-value
            map-options
            options-dense
            label="Date range"
            :options="dateOptions"
            @update:model-value="emit('update:dateRange', $event)"
          />
        </section>

        <section v-if="!$q.screen.lt.md" class="pfxp-sheet-section">
          <h3 class="pfxp-sheet-section__title">Column filters</h3>
          <q-toggle
            :model-value="floatingFilters"
            color="primary"
            label="Show filter row below column headers"
            @update:model-value="emit('update:floatingFilters', $event)"
          />
          <p class="filter-sheet__hint">Text, number, and date filters can be combined directly in the desktop table.</p>
        </section>
      </q-scroll-area>

      <footer class="pfxp-sheet-footer filter-sheet__footer">
        <q-btn flat no-caps label="Reset" @click="emit('reset')" />
        <q-btn unelevated no-caps color="primary" :label="`Show ${matchCount} sessions`" @click="emit('update:modelValue', false)" />
      </footer>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.filter-sheet {
  display: flex;
  flex-direction: column;
}

.filter-sheet__body {
  flex: 1 1 auto;
  height: 100%;
}

.filter-sheet__combine {
  margin-bottom: 12px;
  border: 1px solid var(--pfxp-primary);
  border-radius: 7px;
}

.filter-sheet__term {
  display: flex;
  align-items: center;
  margin: 8px 0;
  gap: 6px;
}

.filter-sheet__move {
  display: flex;
  flex-direction: column;
  width: 28px;
}

.filter-sheet__move .q-btn {
  width: 28px;
  height: 22px;
  min-height: 22px;
}

.filter-sheet__facets {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-sheet__hint {
  margin: 8px 0 0;
  color: var(--pfxp-muted);
  font-size: 12px;
  line-height: 1.5;
}

.filter-sheet__footer .q-btn:last-child {
  min-width: 170px;
}

@media (max-width: 1023px) {
  .filter-sheet {
    height: min(86vh, 760px);
  }
}
</style>
