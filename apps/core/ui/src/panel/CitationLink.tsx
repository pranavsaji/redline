import Tooltip from '@atlaskit/tooltip';
import { token } from '@atlaskit/tokens';
import type { Citation, FactDto } from '../types.js';

/** Every AI-produced line links to its source; hovering or focusing shows the quoted span. */
export function CitationLink({ citation, fact }: { citation: Citation; fact: FactDto | undefined }) {
  const label = fact ? fact.title : 'Source';
  return (
    <Tooltip content={`“${citation.quote}”`} position="top">
      {(props) => (
        <a
          {...props}
          href={fact?.url || undefined}
          target="_top"
          style={{ color: token('color.link'), textDecoration: 'underline', textUnderlineOffset: 2 }}
          aria-label={`Source: ${label}. Quote: ${citation.quote}`}
        >
          {label}
        </a>
      )}
    </Tooltip>
  );
}
