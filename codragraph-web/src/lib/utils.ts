import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const generateId = (label: string, name: string): string => {
  return `${label}:${name}`;
};

/**
 * shadcn/ui canonical class name helper. Merges `clsx` (conditional
 * className composition) with `tailwind-merge` (resolves conflicting
 * Tailwind classes — e.g. `p-2 p-4` becomes `p-4`). Used by every
 * component in src/components/ui/.
 */
export const cn = (...inputs: ClassValue[]): string => {
  return twMerge(clsx(inputs));
};
