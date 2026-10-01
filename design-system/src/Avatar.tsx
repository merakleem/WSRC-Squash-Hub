import type { CSSProperties } from 'react';
import { cx } from './cx';

// renderer/utils.js AVATAR_COLORS and avatarColor(): a name always lands on
// the same dark colour, and every colour keeps white initials legible.
const AVATAR_COLORS = [
  '#1e2758', '#2d4a7c', '#3a3d8f', '#5a3576',
  '#7c2f4a', '#8a3f2a', '#7a5320', '#4a5f24',
  '#1c5f3a', '#15605c', '#175e78', '#44506b',
];

export function avatarColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZE_CLASS = { sm: 'rs-winner-av', md: 'rs-avatar', lg: 'mc-avatar' } as const;

export interface AvatarProps {
  /** The player's full name; gives the initials and the colour. */
  name: string;
  /** A photo URL. When present it replaces the initials. */
  photoUrl?: string;
  /** sm 30px (pickers), md 40px (list rows), lg 60px (match card). */
  size?: 'sm' | 'md' | 'lg';
  /** The "this is you" ring. Drawn at size lg. */
  you?: boolean;
  className?: string;
}

/**
 * A player's circle: their photo when they have one, otherwise their initials
 * in white on a colour picked from their name.
 */
export function Avatar({ name, photoUrl, size = 'md', you, className }: AvatarProps) {
  const cls = cx(SIZE_CLASS[size], you && size === 'lg' && 'mc-avatar--you', photoUrl && 'has-photo', className);
  if (photoUrl) return <div className={cls}><img src={photoUrl} alt={name} /></div>;
  return <div className={cls} style={{ '--avatar-bg': avatarColor(name) } as CSSProperties}>{playerInitials(name)}</div>;
}
