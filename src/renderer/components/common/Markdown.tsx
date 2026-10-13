import { memo, useMemo, useState, type ReactNode } from 'react';
import { createStreamSplitter, parseMarkdown, type Block, type Inline, type ListBlock } from '../../lib/markdown';

// Maps parsed Markdown to React elements. Never uses innerHTML and never emits an href: links show their text with the URL as a tooltip.
function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={k} />;
      case 'code': return <code key={k}>{n.v}</code>;
      case 'bold': return <strong key={k}>{inline(n.c)}</strong>;
      case 'em': return <em key={k}>{inline(n.c)}</em>;
      case 'del': return <del key={k}>{inline(n.c)}</del>;
      case 'link': return <span key={k} className="md-link" title={n.url}>{inline(n.c)}</span>;
    }
  });
}

function list(l: ListBlock, key: number): ReactNode {
  const Tag = l.t;
  return (
    <Tag key={key}>
      {l.items.map((it, k) => <li key={k}>{inline(it.c)}{it.sub && list(it.sub, 0)}</li>)}
    </Tag>
  );
}

function block(b: Block, k: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const H = (['h3', 'h4', 'h5'] as const)[b.level - 1];
      return <H key={k}>{inline(b.c)}</H>;
    }
    case 'code': return <pre key={k}><code>{b.v}</code></pre>;
    case 'quote': return <blockquote key={k}>{inline(b.c)}</blockquote>;
    case 'hr': return <hr key={k} />;
    case 'p': return <p key={k}>{inline(b.c)}</p>;
    default: return list(b, k);
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks.map(block)}</>;
});

/**
 * Markdown for text that is still streaming in. The settled part (up to the last blank line outside a code
 * fence) is a separate memoised block that only re-parses when that boundary moves, so each frame parses just
 * the tail instead of the whole answer. Renders the same DOM as <Markdown> (fragments add no nodes).
 */
export function StreamingMarkdown({ text }: { text: string }) {
  const [split] = useState(createStreamSplitter);
  const cut = split(text);
  return (
    <>
      <Markdown text={text.slice(0, cut)} />
      <Markdown text={text.slice(cut)} />
    </>
  );
}
