// JSX types for the @crossly/embed custom elements, so <crossly-catalog> and
// <crossly-buy-button> type-check in .tsx files. Attributes are strings in HTML.
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type CustomElement<Attributes> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Attributes;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'crossly-catalog': CustomElement<{ pk: string; limit?: string; q?: string; api?: string }>;
      'crossly-buy-button': CustomElement<{
        pk: string;
        listing: string;
        quantity?: string;
        label?: string;
        target?: '_self' | '_blank';
        api?: string;
      }>;
    }
  }
}
