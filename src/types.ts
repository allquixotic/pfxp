import type { PaizoAccountIdentity } from './account';

// Character model from the characters page
export interface Character {
  orgplayid: number;
  charid: number;
  name: string;
  faction: string;
  game: string;
}

// Session detail model
export interface SessionDetail {
  date: string | undefined;
  gm: string;
  scenario: string;
  gameSystem: string; // "Starfinder Playtest" | "Starfinder 1e" | "Starfinder 2e" | "Pathfinder 1e" | "Pathfinder 2e"
  points: {
    achievementPoints: number | null;
    gmCredits: number | null;
  };
  event: {
    id: number;
    name: string;
  };
  session: number;
  player: {
    orgplayid: number;
    charid: number | null;
  };
  character: {
    name: string;
  };
  faction: {
    name: string;
  };
  prestigeReputation: {
    prestigePoints: number;
    isGM: "yes" | "no";
  };
  notes: string | null;
  xp: number;
}

// Summary model for total XP per character
export interface CharacterSummary {
  xp: number;
}

// Complete data structure
export interface PaizoOrganizedPlayData {
  account?: PaizoAccountIdentity;
  details: SessionDetail[];
  characters: Character[];
  summary: Record<string, CharacterSummary>;
}

// Credentials for authentication
export interface Credentials {
  email: string;
  password: string;
}

// API request/response types
export interface CredentialPayload {
  keyId: string;
  ciphertext: string; // base64-encoded RSA-OAEP ciphertext
}

export interface FetchRequest {
  email: string;
  password?: string; // legacy/plain for local trusted networks; prefer credential
  credential?: CredentialPayload;
}

export interface FetchResponse {
  status: 'queued' | 'processing' | 'ready' | 'error' | 'blocked';
  data?: PaizoOrganizedPlayData;
  message?: string;
  retryAfter?: number; // timestamp when retry is allowed
  jobId?: string;      // server-issued job id for progress tracking
}

export interface ProgressEvent {
  jobId: string;
  status: 'queued' | 'processing' | 'ready' | 'error' | 'blocked';
  step?: string;
  message?: string;
  currentPage?: number;
  totalPages?: number;
  percent?: number;
  queuePosition?: number;
  ts: number;
}

// Internal state management
export interface UserData {
  data: PaizoOrganizedPlayData | null;
  lastFetch: number;
  status: 'idle' | 'processing' | 'blocked' | 'error';
  errorCount: number;
  blockedUntil?: number;
}

export interface QueueItem {
  jobId: string;
  email: string;
  password: string;
  queuedAt: number;
}
