import { defineComponent, h, type PropType, type VNodeChild } from 'vue';
import {
  gmRecognitionPlainText,
  type GmRecognitionBlock,
  type GmRecognitionNode,
} from '../../gm-recognition';

function renderNode(node: GmRecognitionNode, key: string): VNodeChild {
  if (node.type === 'text') return node.text;
  if (node.type === 'img') {
    return h('img', {
      key,
      class: 'pfxp-gm-recognition__image',
      src: node.src,
      alt: node.alt,
      width: node.width,
      height: node.height,
      loading: 'lazy',
      decoding: 'async',
      draggable: 'false',
    });
  }
  return h(
    'span',
    {
      key,
      class: [
        'pfxp-gm-recognition__span',
        ...(node.classes ?? []).map((className) => `pfxp-gm-source-${className}`),
      ],
    },
    node.children.map((child, index) => renderNode(child, `${key}-${index}`)),
  );
}

/** Render sanitized structured nodes. No raw HTML reaches Vue's DOM APIs. */
export default defineComponent({
  name: 'GmRecognitions',
  props: {
    blocks: {
      type: Array as PropType<GmRecognitionBlock[]>,
      required: true,
    },
  },
  setup(props) {
    return () => h(
      'div',
      {
        class: 'pfxp-gm-recognitions',
        'aria-label': 'Paizo GM recognition',
      },
      props.blocks.map((block, blockIndex) => h(
        'p',
        {
          key: `${gmRecognitionPlainText(block)}-${blockIndex}`,
          class: 'pfxp-gm-recognition',
        },
        block.nodes.map((node, nodeIndex) => renderNode(node, `${blockIndex}-${nodeIndex}`)),
      )),
    );
  },
});
