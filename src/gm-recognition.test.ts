import { describe, expect, test } from 'bun:test';
import {
  gmRecognitionPlainText,
  sanitizeGmRecognitions,
  type GmRecognitionBlock,
} from './gm-recognition';

function currentGlyphBlock(): GmRecognitionBlock {
  return {
    nodes: [
      { type: 'text', text: '\n  You are a  ' },
      {
        type: 'span',
        classes: ['referenceable'],
        children: [{
          type: 'span',
          classes: ['stars'],
          children: [
            {
              type: 'img',
              src: 'https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png',
              alt: '*',
              width: 24,
              height: 25,
            },
            {
              type: 'img',
              src: 'https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png',
              alt: '*',
              width: 24,
              height: 25,
            },
          ],
        }],
      },
      { type: 'text', text: ' Pathfinder Society (second edition) GM. \n' },
    ],
  };
}

describe('GM recognition sanitizer', () => {
  test('keeps current Paizo glyph content as bounded structured markup', () => {
    const [block] = sanitizeGmRecognitions([currentGlyphBlock()]);
    expect(block).toBeDefined();
    expect(gmRecognitionPlainText(block!)).toBe(
      'You are a Pathfinder Society (second edition) GM.',
    );
    expect(block?.nodes[1]).toMatchObject({
      type: 'span',
      classes: ['referenceable'],
    });
  });

  test('omits unsafe URLs, unsupported markup, and unrelated prose', () => {
    const foreignImage = currentGlyphBlock();
    const stars = foreignImage.nodes[1];
    if (stars?.type === 'span' && stars.children[0]?.type === 'span') {
      const image = stars.children[0].children[0];
      if (image?.type === 'img') image.src = 'https://tracker.example/glyph.png';
    }
    const unsupported = {
      nodes: [
        { type: 'text', text: 'You are a ' },
        { type: 'iframe', src: 'https://paizo.com/advertisement' },
        { type: 'text', text: 'Pathfinder Society GM.' },
      ],
    };
    const unrelated = {
      nodes: [
        { type: 'text', text: 'You are a valued customer.' },
        {
          type: 'img',
          src: 'https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png',
          alt: '*',
        },
      ],
    };
    expect(sanitizeGmRecognitions([foreignImage, unsupported, unrelated])).toEqual([]);
  });

  test('omits oversized and deeply nested blocks', () => {
    const oversized = currentGlyphBlock();
    oversized.nodes.push({ type: 'text', text: 'x'.repeat(700) });
    const deeplyNested = {
      nodes: [{
        type: 'span',
        children: [{
          type: 'span',
          children: [{
            type: 'span',
            children: [{
              type: 'span',
              children: currentGlyphBlock().nodes,
            }],
          }],
        }],
      }],
    };
    expect(sanitizeGmRecognitions([oversized, deeplyNested])).toEqual([]);
  });

  test('keeps separate future-system recognition paragraphs with the same safe shape', () => {
    const futureBlock: GmRecognitionBlock = {
      nodes: [
        { type: 'text', text: 'You are a ' },
        {
          type: 'span',
          classes: ['recognition-meter'],
          children: [{
            type: 'img',
            src: 'https://cdn.paizo.com/image/content/OrganizedPlay/SFS2RecognitionIcon.png',
            alt: 'Recognition mark',
            width: 25,
            height: 25,
          }],
        },
        { type: 'text', text: ' Starfinder Society (second edition) GM.' },
      ],
    };
    const blocks = sanitizeGmRecognitions([currentGlyphBlock(), futureBlock]);
    expect(blocks.map(gmRecognitionPlainText)).toEqual([
      'You are a Pathfinder Society (second edition) GM.',
      'You are a Starfinder Society (second edition) GM.',
    ]);
  });
});
