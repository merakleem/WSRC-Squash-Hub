import { useState, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { avatarColor, playerInitials } from './Avatar';
import crest from './crest.png';

export type AppPage =
  | 'dashboard' | 'ladder' | 'leagues' | 'tournaments' | 'events' | 'courtBooking'
  | 'players' | 'activity' | 'schedule' | 'clubSettings';

interface NavItem { page: AppPage; label: string; icon: IconName }

// The sidebar exactly as renderer/index.html lays it out.
const NAV: Array<{ label: string; adminOnly?: boolean; items: NavItem[] }> = [
  { label: 'Play', items: [
    { page: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { page: 'ladder', label: 'Ladder', icon: 'ladder' },
    { page: 'leagues', label: 'Leagues', icon: 'leagues' },
    { page: 'tournaments', label: 'Tournaments', icon: 'trophy' },
    { page: 'events', label: 'Events', icon: 'ticket' },
    { page: 'courtBooking', label: 'Book a Court', icon: 'court' },
  ] },
  { label: 'Club', items: [
    { page: 'players', label: 'Players', icon: 'players' },
    { page: 'activity', label: 'Club Activity', icon: 'activity' },
  ] },
  { label: 'Admin', adminOnly: true, items: [
    { page: 'schedule', label: 'Court Schedule', icon: 'clock' },
    { page: 'clubSettings', label: 'Club Settings', icon: 'settings' },
  ] },
];

export interface AppShellProps {
  /** Who is signed in. Admins get the Admin nav group and the admin footer card. */
  role?: 'player' | 'admin';
  /** The signed-in player's name, shown in the sidebar's profile card. */
  playerName?: string;
  /** The nav item to highlight. */
  activePage?: AppPage;
  /** The page title in the top bar (Barlow 18). */
  title: ReactNode;
  /** Show the top bar's Back button (detail pages). */
  back?: boolean;
  /** Buttons on the right of the top bar - usually one primary <Button size="sm">. */
  actions?: ReactNode;
  /** Remove the page padding, for a page that lays out its own edges. */
  flush?: boolean;
  /** The page itself. It scrolls inside the shell, below the top bar. */
  children?: ReactNode;
}

/**
 * The whole app frame: the navy sidebar, the white top bar with the page
 * title and its actions, and the grey content area the page draws into.
 * Every full-page design starts here. Below 768px the sidebar becomes a
 * drawer behind the hamburger, as in the app.
 */
export function AppShell({ role = 'player', playerName = 'Alex Morgan', activePage = 'dashboard', title, back, actions, flush, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-container">
      <button className={cx('hamburger-btn', open && 'open')} aria-label="Menu" onClick={() => setOpen(!open)}>
        <span className="bar" /><span className="bar" /><span className="bar" />
      </button>
      <div className={cx('sidebar-overlay', open && 'open')} onClick={() => setOpen(false)} />
      <aside className={cx('sidebar', `sb-role-${role}`, open && 'mobile-open')}>
        <div className="sidebar-logo">
          <span className="sb-crest"><img src={crest} alt="WSRC" /></span>
          <span className="sb-wordmark">
            <span className="sb-word-play">Play</span>
            <span className="sb-word-club">WSRC</span>
          </span>
        </div>
        <nav className="sidebar-nav">
          {NAV.filter((g) => !g.adminOnly || role === 'admin').map((g) => (
            <div className="sb-group" key={g.label}>
              <span className="sb-group-label">{g.label}</span>
              {g.items.map((it) => (
                <a key={it.page} className={cx('nav-item', it.page === activePage && 'active')}>
                  <Icon name={it.icon} className="nav-icon" strokeWidth={1.9} />
                  {it.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <button className="sb-profile">
          <span className="sb-profile-avatar" style={{ ['--avatar-bg' as string]: avatarColor(playerName) }}>{playerInitials(playerName)}</span>
          <span className="sb-profile-text">
            <span className="sb-profile-name">{playerName}</span>
            <span className="sb-profile-role">Player</span>
          </span>
          <svg className="sb-profile-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>
        </button>
        <div className="sb-admin">
          <span className="sb-admin-badge"><Icon name="shield" strokeWidth={1.9} /></span>
          <span className="sb-admin-text">
            <span className="sb-admin-name">Administrator</span>
            <span className="sb-admin-sub">Club management</span>
          </span>
          <a className="sb-admin-logout" title="Logout" aria-label="Logout"><Icon name="logout" strokeWidth={1.9} /></a>
        </div>
      </aside>
      <div className="main-wrapper">
        <header className="topbar">
          <div className="topbar-left">
            {back ? <button className="btn-back"><Icon name="back" strokeWidth={2.5} />Back</button> : null}
            <h1 className="topbar-title">{title}</h1>
          </div>
          <div className="topbar-actions">{actions}</div>
        </header>
        <main className={cx('content', flush && 'content--flush')}>{children}</main>
      </div>
    </div>
  );
}
