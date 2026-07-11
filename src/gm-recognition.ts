/** Text copied from a Paizo GM-recognition paragraph. */
export interface GmRecognitionTextNode {
  type: 'text';
  text: string;
}

/** A bounded inline container copied from Paizo markup. */
export interface GmRecognitionSpanNode {
  type: 'span';
  classes?: string[];
  children: GmRecognitionNode[];
}

/** A glyph/nova-style image hosted in Paizo's Organized Play image tree. */
export interface GmRecognitionImageNode {
  type: 'img';
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Renderable node types. Raw HTML is deliberately not part of this model. */
export type GmRecognitionNode =
  | GmRecognitionTextNode
  | GmRecognitionSpanNode
  | GmRecognitionImageNode;

/** One source `<p>` describing GM recognition for a game system. */
export interface GmRecognitionBlock {
  nodes: GmRecognitionNode[];
}

const MAX_BLOCKS = 8;
const MAX_NODES_PER_BLOCK = 64;
const MAX_IMAGES_PER_BLOCK = 12;
const MAX_TEXT_PER_BLOCK = 512;
const MAX_DEPTH = 3;
const MAX_IMAGE_DIMENSION = 96;
const MAX_IMAGE_URL_LENGTH = 512;
const MAX_ALT_LENGTH = 80;
const MAX_CLASSES_PER_SPAN = 4;
const SAFE_CLASS = /^[a-z][a-z0-9_-]{0,39}$/i;
const RECOGNITION_TEXT = /^You are an?\s+.+\s+GM\.$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase('en-US');
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
    if (hostname !== 'paizo.com' && !hostname.endsWith('.paizo.com')) return null;
    if (!url.pathname.startsWith('/image/content/OrganizedPlay/')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeDimension(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_IMAGE_DIMENSION) {
    return null;
  }
  return value as number;
}

function safeClasses(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CLASSES_PER_SPAN) return null;
  const classes: string[] = [];
  for (const className of value) {
    if (typeof className !== 'string' || !SAFE_CLASS.test(className)) return null;
    if (!classes.includes(className)) classes.push(className);
  }
  return classes.length ? classes : undefined;
}

interface SanitizeBudget {
  nodes: number;
  images: number;
  text: number;
}

function sanitizeNode(
  value: unknown,
  depth: number,
  budget: SanitizeBudget,
): GmRecognitionNode | null {
  if (!isRecord(value) || depth > MAX_DEPTH) return null;
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES_PER_BLOCK) return null;

  if (value.type === 'text') {
    if (typeof value.text !== 'string') return null;
    const text = value.text.replace(/\s+/gu, ' ');
    budget.text += text.length;
    if (budget.text > MAX_TEXT_PER_BLOCK) return null;
    return { type: 'text', text };
  }

  if (value.type === 'img') {
    const src = safeImageUrl(value.src);
    if (!src || typeof value.alt !== 'string' || value.alt.length > MAX_ALT_LENGTH) return null;
    const width = safeDimension(value.width);
    const height = safeDimension(value.height);
    if (width === null || height === null) return null;
    budget.images += 1;
    if (budget.images > MAX_IMAGES_PER_BLOCK) return null;
    return {
      type: 'img',
      src,
      alt: value.alt,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    };
  }

  if (value.type === 'span') {
    if (!Array.isArray(value.children) || value.children.length === 0) return null;
    const classes = safeClasses(value.classes);
    if (classes === null) return null;
    const children: GmRecognitionNode[] = [];
    for (const child of value.children) {
      const sanitized = sanitizeNode(child, depth + 1, budget);
      if (!sanitized) return null;
      children.push(sanitized);
    }
    return {
      type: 'span',
      ...(classes ? { classes } : {}),
      children,
    };
  }

  return null;
}

function nodeText(node: GmRecognitionNode): string {
  if (node.type === 'text') return node.text;
  if (node.type === 'img') return '';
  return node.children.map(nodeText).join('');
}

/** Plain prose for accessibility, matching, and diagnostics. */
export function gmRecognitionPlainText(block: GmRecognitionBlock): string {
  return block.nodes.map(nodeText).join('').replace(/\s+/gu, ' ').trim();
}

function sanitizeBlock(value: unknown): GmRecognitionBlock | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || value.nodes.length === 0) return null;
  const budget: SanitizeBudget = { nodes: 0, images: 0, text: 0 };
  const nodes: GmRecognitionNode[] = [];
  for (const node of value.nodes) {
    const sanitized = sanitizeNode(node, 0, budget);
    if (!sanitized) return null;
    nodes.push(sanitized);
  }
  if (budget.images === 0) return null;
  const block = { nodes } satisfies GmRecognitionBlock;
  return RECOGNITION_TEXT.test(gmRecognitionPlainText(block)) ? block : null;
}

/**
 * Validate untrusted scraper/import data into a render-safe structured subset.
 * Invalid blocks are omitted independently so one future Paizo change cannot
 * poison otherwise valid session data.
 */
export function sanitizeGmRecognitions(value: unknown): GmRecognitionBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: GmRecognitionBlock[] = [];
  for (const candidate of value.slice(0, MAX_BLOCKS)) {
    const sanitized = sanitizeBlock(candidate);
    if (sanitized) blocks.push(sanitized);
  }
  return blocks;
}
