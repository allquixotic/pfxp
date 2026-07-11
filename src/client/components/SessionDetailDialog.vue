<script setup lang="ts">
import { computed } from 'vue';
import { copyToClipboard, useQuasar } from 'quasar';
import type { SessionDetail } from '../domain';

const props = defineProps<{
  modelValue: boolean;
  session: SessionDetail | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  filterCharacter: [name: string];
}>();

const $q = useQuasar();
const position = computed(() => $q.screen.lt.md ? 'bottom' : 'right');
const gameClass = computed(() => {
  const system = props.session?.gameSystem ?? '';
  if (system.includes('Starfinder')) return 'pfxp-game--sf';
  if (system.includes('Pathfinder 1')) return 'pfxp-game--pf1';
  if (!system.includes('Pathfinder')) return 'pfxp-game--other';
  return '';
});

function display(value: unknown) {
  return value == null || value === '' ? '—' : String(value);
}

async function copy(value: unknown, label: string) {
  if (value == null || value === '') return;
  await copyToClipboard(String(value));
  $q.notify({ message: `${label} copied`, icon: 'r_content_copy', color: 'primary' });
}
</script>

<template>
  <q-dialog
    :model-value="modelValue"
    :position="position"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card v-if="session" :class="position === 'bottom' ? 'pfxp-bottom-sheet detail-sheet' : 'pfxp-side-sheet detail-sheet'">
      <div v-if="position === 'bottom'" class="detail-sheet__handle" aria-hidden="true" />
      <header class="pfxp-sheet-header detail-sheet__header">
        <div class="col">
          <h2 class="pfxp-sheet-title">{{ session.scenario || 'Session details' }}</h2>
          <div class="pfxp-sheet-subtitle">
            {{ display(session.date) }}
            <span aria-hidden="true"> · </span>
            <span :class="['pfxp-game', gameClass]">{{ session.gameSystem }}</span>
          </div>
        </div>
        <strong class="detail-sheet__xp">{{ session.xp }} XP</strong>
        <q-btn flat round icon="r_close" aria-label="Close session details" @click="emit('update:modelValue', false)" />
      </header>

      <q-scroll-area class="detail-sheet__body">
        <q-list class="pfxp-detail-list">
          <q-item>
            <q-item-section avatar><q-icon name="r_person" /></q-item-section>
            <q-item-section><q-item-label caption>Character</q-item-label><q-item-label>{{ display(session.character.name) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_badge" /></q-item-section>
            <q-item-section><q-item-label caption>Org Play ID</q-item-label><q-item-label>{{ display(session.player.orgplayid) }}</q-item-label></q-item-section>
            <q-item-section side><q-btn flat round icon="r_content_copy" aria-label="Copy Org Play ID" @click="copy(session.player.orgplayid, 'Org Play ID')" /></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_badge" /></q-item-section>
            <q-item-section><q-item-label caption>Character ID</q-item-label><q-item-label>{{ display(session.player.charid) }}</q-item-label></q-item-section>
            <q-item-section side><q-btn flat round icon="r_content_copy" aria-label="Copy Character ID" @click="copy(session.player.charid, 'Character ID')" /></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon :name="session.prestigeReputation.isGM === 'yes' ? 'r_stars' : 'r_account_circle'" /></q-item-section>
            <q-item-section><q-item-label caption>Role</q-item-label><q-item-label>{{ session.prestigeReputation.isGM === 'yes' ? 'GM' : 'Player' }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_supervisor_account" /></q-item-section>
            <q-item-section><q-item-label caption>GM</q-item-label><q-item-label>{{ display(session.gm) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_event" /></q-item-section>
            <q-item-section><q-item-label caption>Event</q-item-label><q-item-label>{{ display(session.event.name) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_tag" /></q-item-section>
            <q-item-section><q-item-label caption>Event ID</q-item-label><q-item-label>{{ display(session.event.id) }}</q-item-label></q-item-section>
            <q-item-section side><q-btn flat round icon="r_content_copy" aria-label="Copy Event ID" @click="copy(session.event.id, 'Event ID')" /></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_numbers" /></q-item-section>
            <q-item-section><q-item-label caption>Session</q-item-label><q-item-label>{{ display(session.session) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_shield" /></q-item-section>
            <q-item-section><q-item-label caption>Faction</q-item-label><q-item-label>{{ display(session.faction.name) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_workspace_premium" /></q-item-section>
            <q-item-section><q-item-label caption>Prestige / Reputation</q-item-label><q-item-label>{{ display(session.prestigeReputation.prestigePoints) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_auto_awesome" /></q-item-section>
            <q-item-section><q-item-label caption>Achievement Points</q-item-label><q-item-label>{{ display(session.points.achievementPoints) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_paid" /></q-item-section>
            <q-item-section><q-item-label caption>GM Credits</q-item-label><q-item-label>{{ display(session.points.gmCredits) }}</q-item-label></q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar><q-icon name="r_notes" /></q-item-section>
            <q-item-section><q-item-label caption>Notes</q-item-label><q-item-label>{{ session.notes || 'No notes' }}</q-item-label></q-item-section>
          </q-item>
        </q-list>
      </q-scroll-area>

      <footer class="pfxp-sheet-footer">
        <q-btn flat no-caps label="Close" @click="emit('update:modelValue', false)" />
        <q-btn
          outline
          no-caps
          color="primary"
          icon="r_filter_alt"
          label="Filter by this character"
          @click="emit('filterCharacter', session.character.name)"
        />
      </footer>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.detail-sheet {
  display: flex;
  flex-direction: column;
}

.detail-sheet__handle {
  width: 46px;
  height: 5px;
  margin: 10px auto -2px;
  border-radius: 4px;
  background: var(--pfxp-border-strong);
}

.detail-sheet__header {
  align-items: center;
}

.detail-sheet__xp {
  color: var(--pfxp-primary);
  font-size: 18px;
  white-space: nowrap;
}

.detail-sheet__body {
  flex: 1 1 auto;
  height: 100%;
  padding: 4px 22px;
}

.pfxp-sheet-subtitle {
  display: flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 1023px) {
  .detail-sheet {
    height: min(82vh, 760px);
  }

  .detail-sheet__body {
    padding-inline: 16px;
  }
}
</style>
