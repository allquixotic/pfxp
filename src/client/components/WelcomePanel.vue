<script setup lang="ts">
import { computed, ref, watch } from 'vue';

export interface WelcomeRun {
  id: string;
  label: string;
  timestamp: number;
  source: string;
  sessions?: number;
  characters?: number;
}

const props = defineProps<{
  email: string;
  busy?: boolean;
  runs?: WelcomeRun[];
}>();

const emit = defineEmits<{
  'update:email': [value: string];
  submit: [value: { email: string; password: string }];
  import: [file: File];
  loadRun: [id: string];
  manageRuns: [];
}>();

const password = ref('');
const showPassword = ref(false);
const dragActive = ref(false);
const fileInput = ref<HTMLInputElement>();
const localEmail = ref(props.email);

watch(() => props.email, (value) => { localEmail.value = value; });

const canSubmit = computed(() => /^\S+@\S+\.\S+$/.test(localEmail.value.trim()) && password.value.length > 0);

function submit() {
  if (!canSubmit.value || props.busy) return;
  const submittedEmail = localEmail.value.trim();
  const submittedPassword = password.value;

  // Hand the parent a short-lived copy, then immediately clear the bound field.
  // The parent/API pipeline owns the copy only long enough to encrypt it.
  password.value = '';
  showPassword.value = false;
  emit('update:email', submittedEmail);
  emit('submit', { email: submittedEmail, password: submittedPassword });
}

function chooseFile() {
  fileInput.value?.click();
}

function acceptFile(file?: File) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') return;
  emit('import', file);
}

function onDrop(event: DragEvent) {
  dragActive.value = false;
  acceptFile(event.dataTransfer?.files?.[0]);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}
</script>

<template>
  <section class="welcome" aria-labelledby="welcome-title">
    <header class="welcome__heading">
      <h1 id="welcome-title">Open your Organized Play history</h1>
      <p>Sign in to fetch your Paizo sessions, or open a PFXP JSON export.</p>
    </header>

    <div class="welcome__surface">
      <q-form class="welcome__pane" @submit.prevent="submit">
        <h2>Sign in to Paizo</h2>
        <q-input
          v-model="localEmail"
          autofocus
          outlined
          stack-label
          type="email"
          autocomplete="email"
          label="Email"
          class="welcome__field"
          :disable="busy"
          @blur="emit('update:email', localEmail.trim())"
        />
        <q-input
          v-model="password"
          outlined
          stack-label
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          label="Password"
          class="welcome__field"
          :disable="busy"
        >
          <template #append>
            <q-btn
              flat
              round
              dense
              :icon="showPassword ? 'r_visibility_off' : 'r_visibility'"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              @click="showPassword = !showPassword"
            />
          </template>
        </q-input>
        <q-btn
          unelevated
          no-caps
          color="primary"
          class="welcome__primary"
          type="submit"
          label="Fetch sessions"
          :loading="busy"
          :disable="!canSubmit"
        />
        <div class="welcome__privacy">
          <q-icon name="r_lock" size="18px" />
          <span>Encrypted in your browser. Credentials are never saved.</span>
        </div>
      </q-form>

      <div class="welcome__divider" aria-hidden="true"><span>or</span></div>

      <section class="welcome__pane" aria-labelledby="import-title">
        <h2 id="import-title">Open an export</h2>
        <div
          class="welcome__dropzone"
          :class="{ 'welcome__dropzone--active': dragActive }"
          role="button"
          tabindex="0"
          @click="chooseFile"
          @keydown.enter.prevent="chooseFile"
          @keydown.space.prevent="chooseFile"
          @dragenter.prevent="dragActive = true"
          @dragover.prevent="dragActive = true"
          @dragleave.prevent="dragActive = false"
          @drop.prevent="onDrop"
        >
          <q-icon name="r_description" size="34px" />
          <strong>Drop a PFXP JSON file here</strong>
          <q-btn outline no-caps color="primary" label="Choose file" @click.stop="chooseFile" />
        </div>
        <input
          ref="fileInput"
          class="welcome__file-input"
          type="file"
          accept="application/json,.json"
          @change="acceptFile(($event.target as HTMLInputElement).files?.[0])"
        >
        <div class="welcome__privacy">
          <q-icon name="r_shield" size="18px" />
          <span>Everything stays in this browser.</span>
        </div>
      </section>
    </div>

    <section v-if="runs?.length" class="welcome__runs" aria-labelledby="recent-runs-title">
      <div class="welcome__runs-heading">
        <h2 id="recent-runs-title">Previous runs</h2>
        <q-btn flat no-caps color="primary" label="Manage runs" @click="emit('manageRuns')" />
      </div>
      <q-list bordered separator class="welcome__run-list">
        <q-item
          v-for="run in runs.slice(0, 2)"
          :key="run.id"
          clickable
          v-ripple
          @click="emit('loadRun', run.id)"
        >
          <q-item-section avatar>
            <q-icon name="r_history" color="primary" size="26px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="text-weight-bold">{{ run.label }}</q-item-label>
            <q-item-label caption>{{ formatDate(run.timestamp) }} · {{ run.source }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="run.sessions != null" side class="welcome__run-counts">
            <span>{{ run.sessions }} sessions</span>
            <span v-if="run.characters != null">{{ run.characters }} characters</span>
          </q-item-section>
          <q-item-section side>
            <q-icon name="r_chevron_right" />
          </q-item-section>
        </q-item>
      </q-list>
    </section>
  </section>
</template>

<style scoped>
.welcome {
  width: min(960px, 100%);
  margin: auto;
  padding: 30px 0 48px;
}

.welcome__heading {
  margin-bottom: 24px;
  text-align: center;
}

.welcome__heading h1 {
  margin: 0;
  color: var(--pfxp-text);
  font-size: clamp(25px, 3vw, 34px);
  font-weight: 760;
  letter-spacing: -0.035em;
}

.welcome__heading p {
  margin: 10px 0 0;
  color: var(--pfxp-muted);
  font-size: 15px;
}

.welcome__surface {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 46px minmax(0, 1fr);
  padding: 18px;
  background: var(--pfxp-surface);
  border: 1px solid var(--pfxp-border-strong);
  border-radius: 10px;
}

.welcome__pane {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 14px;
}

.welcome__pane h2,
.welcome__runs-heading h2 {
  margin: 0;
  color: var(--pfxp-text);
  font-size: 17px;
  font-weight: 740;
}

.welcome__field :deep(.q-field__control) {
  min-height: 52px;
  border-radius: 7px;
}

.welcome__primary {
  min-height: 48px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 700;
}

.welcome__privacy {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  color: var(--pfxp-muted);
  gap: 7px;
  font-size: 12px;
}

.welcome__divider {
  position: relative;
  display: grid;
  place-items: center;
  color: var(--pfxp-muted);
  font-size: 11px;
  text-transform: uppercase;
}

.welcome__divider::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--pfxp-border);
  content: "";
}

.welcome__divider span {
  z-index: 1;
  padding: 8px 4px;
  background: var(--pfxp-surface);
}

.welcome__dropzone {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 195px;
  padding: 22px;
  color: var(--pfxp-muted);
  border: 1px dashed var(--pfxp-border-strong);
  border-radius: 8px;
  cursor: pointer;
  gap: 14px;
  text-align: center;
  transition: border-color 140ms ease, background 140ms ease;
}

.welcome__dropzone strong {
  color: var(--pfxp-text);
  font-weight: 650;
}

.welcome__dropzone:hover,
.welcome__dropzone:focus-visible,
.welcome__dropzone--active {
  outline: none;
  background: var(--pfxp-primary-soft);
  border-color: var(--pfxp-primary);
  box-shadow: 0 0 0 3px var(--pfxp-focus);
}

.welcome__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.welcome__runs {
  margin-top: 26px;
}

.welcome__runs-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.welcome__run-list {
  overflow: hidden;
  background: var(--pfxp-surface);
  border-color: var(--pfxp-border-strong);
  border-radius: 8px;
}

.welcome__run-list .q-item {
  min-height: 72px;
}

.welcome__run-counts {
  align-items: flex-end;
  color: var(--pfxp-muted);
  font-size: 12px;
}

@media (max-width: 720px) {
  .welcome {
    padding: 12px 0 28px;
  }

  .welcome__heading {
    padding: 0 8px;
  }

  .welcome__heading p {
    font-size: 14px;
  }

  .welcome__surface {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .welcome__divider {
    min-height: 38px;
  }

  .welcome__divider::before {
    top: 50%;
    right: 0;
    bottom: auto;
    left: 0;
    width: auto;
    height: 1px;
  }

  .welcome__dropzone {
    min-height: 160px;
  }

  .welcome__run-counts {
    display: none;
  }
}
</style>
