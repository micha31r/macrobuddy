import * as Solid from '@heroicons/react/24/solid';
import type { ComponentType, SVGProps } from 'react';

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Resolve a heroicons kebab-case name (e.g. "magnifying-glass") to its
 * 24px solid component. Handles digit-heavy names too:
 * "squares-2x2" → Squares2X2Icon, "square-3-stack-3d" → Square3Stack3DIcon.
 */
export function resolveIcon(name: string): IconComponent | undefined {
  const pascal = name
    .split('-')
    .map((segment) =>
      segment
        .replace(/^[a-z]/, (c) => c.toUpperCase())
        .replace(/(\d)([a-z])/g, (_, digit: string, c: string) => digit + c.toUpperCase()),
    )
    .join('');
  const icon = (Solid as Record<string, IconComponent | undefined>)[`${pascal}Icon`];
  if (!icon) console.warn(`[icons] unknown heroicon "${name}"`);
  return icon;
}
