import { clsx, type ClassValue } from 'clsx';

/** Tiny class combiner. (Tailwind-merge can be added when class conflicts appear.) */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
