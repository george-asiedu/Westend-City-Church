'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  ChevronDown,
  Download,
  FolderOpen,
  Home,
  Link2,
  LogOut,
  Moon,
  Plus,
  ScrollText,
  Search,
  Settings2,
  Shield,
  Sun,
  Trash2,
  User,
  Users,
  Church as ChurchIcon,
  ClipboardCheck,
  Contact,
  CalendarDays,
  HeartHandshake,
  Megaphone,
  UserRound,
} from 'lucide-react';
import { ROLE_LABELS } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useCategories, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { InstallPrompt, OfflineBanner, OfflineSync, installApp } from './pwa';

function useCdnSession(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const run = () => api('/delivery/cdn-session').catch(() => undefined);
    void run();
    const t = setInterval(run, 90 * 60_000); // cookies last 2 h (§8.4)
    return () => clearInterval(t);
  }, [enabled]);
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.classList.contains('dark') || (!root.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.remove('dark', 'light');
  root.classList.add(dark ? 'light' : 'dark');
  try {
    localStorage.setItem('wcc-theme', dark ? 'light' : 'dark');
  } catch {
    /* ignore */
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const categories = useCategories();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  useCdnSession(!!me.data && !me.data.mustEnable2fa);
  // Unread announcements badge (cheap: one count, refreshed every few minutes).
  const unread = useQuery({
    queryKey: ['announcements', 'unread'],
    queryFn: () => api<{ unread: number }>('/announcements', { query: { limit: 1 } }).then((r) => r.unread),
    enabled: !!me.data && !me.data.mustEnable2fa,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    if (me.data?.mustEnable2fa && !pathname.startsWith('/account')) router.replace('/account?setup2fa=1');
  }, [me.data, pathname, router]);

  if (me.isLoading || !me.data) return <PageLoader />;
  const user = me.data;
  const p = user.permissions;

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    // Drop cached app pages so the next person on this device starts clean.
    if ('caches' in window) for (const k of await caches.keys()) if (k.includes('-pages')) await caches.delete(k);
    window.location.assign('/login?signedOut=1');
  }

  const nav = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/search', label: 'Search', icon: Search },
    ...(p.canUploadAnywhere ? [{ href: '/add', label: 'Add', icon: Plus }] : []),
    { href: '/downloads', label: 'Downloads', icon: Download },
    ...(user.role !== 'VIEWER' ? [{ href: '/trash', label: 'Trash', icon: Trash2 }] : []),
  ];
  const leader = p.canManageMembership || user.role === 'PASTOR' || user.role === 'SHEPHERD';
  const news = { href: '/announcements', label: 'Announcements', icon: Megaphone };
  const church = [
    news,
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    ...(user.memberId ? [{ href: '/me/church', label: 'My church', icon: UserRound }] : []),
    ...(p.canViewMembership
      ? [
          { href: '/church/attendance', label: 'Attendance', icon: ClipboardCheck },
          { href: '/church/members', label: 'Members', icon: Contact },
          { href: '/church/groups', label: 'Groups', icon: ChurchIcon },
        ]
      : []),
    ...(leader ? [{ href: '/church/follow-ups', label: 'Follow-ups', icon: HeartHandshake }] : []),
  ];
  // Phone bar: one "Church" tab instead of three (the Church pages have their own tabs).
  const mobileNews = { ...news, label: 'News' };
  const mobileNav = p.canViewMembership
    ? [...nav.filter((n) => n.href !== '/downloads' && n.href !== '/trash'), mobileNews, { href: '/church', label: 'Church', icon: ChurchIcon }]
    : [...nav.filter((n) => n.href !== '/downloads' && n.href !== '/trash'), mobileNews, user.memberId ? { href: '/me/church', label: 'My church', icon: UserRound } : { href: '/calendar', label: 'Calendar', icon: CalendarDays }];
  const badge = (href: string) =>
    href === '/announcements' && unread.data ? (
      <span className="ml-auto rounded-full bg-brand px-1.5 text-[10px] font-semibold leading-4 text-white" aria-label={`${unread.data} unread`}>
        {unread.data > 9 ? '9+' : unread.data}
      </span>
    ) : null;
  const admin = [
    ...(p.isAdmin ? [{ href: '/admin/users', label: 'Users', icon: Users }] : []),
    ...(p.canViewAudit ? [{ href: '/admin/audit', label: 'Audit log', icon: ScrollText }] : []),
    ...(p.canManageCategories ? [{ href: '/admin/categories', label: 'Categories', icon: Settings2 }] : []),
    ...(p.isAdmin ? [{ href: '/admin/storage', label: 'Storage', icon: BarChart3 }] : []),
  ];
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <OfflineSync userId={user.id} />
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur safe-top">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 lg:px-6 2xl:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" width={28} height={28} />
            <span className="hidden sm:inline">WCC Media</span>
          </Link>
          <form
            className="ml-2 hidden max-w-xl flex-1 md:block"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              if (q) router.push(`/search?q=${encodeURIComponent(String(q))}`);
            }}
          >
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input name="q" placeholder="Search events, captions, tags…" className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm focus:border-brand focus:outline-none" />
            </label>
          </form>
          <div className="ml-auto flex items-center gap-2">
            {p.canUploadAnywhere && (
              <Link href="/add" className="hidden sm:block">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Add media
                </Button>
              </Link>
            )}
            <Menu>
              <MenuTrigger asChild>
                <button className="group flex items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-surface-2 data-[state=open]:bg-surface-2" aria-label="Account menu">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand">{user.fullName.slice(0, 1).toUpperCase()}</span>
                  <ChevronDown className="h-4 w-4 text-muted transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                </button>
              </MenuTrigger>
              <MenuContent>
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{user.fullName}</p>
                  <p className="text-xs text-muted">{ROLE_LABELS[user.role]}</p>
                </div>
                <MenuSeparator />
                <MenuItem onSelect={() => router.push('/account')}>
                  <User className="h-4 w-4" /> Account & security
                </MenuItem>
                {p.canViewMembership && (
                  <MenuItem onSelect={() => router.push('/downloads')}>
                    <Download className="h-4 w-4" /> Downloads
                  </MenuItem>
                )}
                <MenuItem onSelect={() => router.push('/shares')}>
                  <Link2 className="h-4 w-4" /> Share links
                </MenuItem>
                {admin.map((a) => (
                  <MenuItem key={a.href} onSelect={() => router.push(a.href)}>
                    <a.icon className="h-4 w-4" /> {a.label}
                  </MenuItem>
                ))}
                <MenuItem onSelect={() => void installApp()}>
                  <Download className="h-4 w-4" /> Install app
                </MenuItem>
                <MenuItem onSelect={toggleTheme}>
                  <Moon className="h-4 w-4 dark:hidden" />
                  <Sun className="hidden h-4 w-4 dark:block" /> Toggle theme
                </MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={logout} danger>
                  <LogOut className="h-4 w-4" /> Sign out
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-4 pb-24 pt-6 md:pb-10 lg:gap-8 lg:px-6 2xl:px-8">
        <aside className="sticky top-20 hidden h-[calc(100dvh-6rem)] w-56 shrink-0 overflow-y-auto lg:block">
          <nav className="space-y-0.5 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2', active(n.href) && 'bg-surface-2 font-medium')}>
                <n.icon className="h-4 w-4" /> {n.label === 'Add' ? 'Add media' : n.label}
              </Link>
            ))}
            <Link href="/shares" className={cn('flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2', active('/shares') && 'bg-surface-2 font-medium')}>
              <Link2 className="h-4 w-4" /> Share links
            </Link>
            {church.length > 0 && <p className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted">Church</p>}
            {church.map((n) => (
              <Link key={n.href} href={n.href} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2', active(n.href) && 'bg-surface-2 font-medium')}>
                <n.icon className="h-4 w-4" /> {n.label}
                {badge(n.href)}
              </Link>
            ))}
            <p className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted">Folders</p>
            {categories.data?.filter((c) => c.isActive).map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className={cn('flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2', pathname.startsWith(`/c/${c.slug}`) && 'bg-surface-2 font-medium')}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
                <span className="truncate">{c.name}</span>
              </Link>
            ))}
            {admin.length > 0 && <p className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted">Admin</p>}
            {admin.map((a) => (
              <Link key={a.href} href={a.href} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2', active(a.href) && 'bg-surface-2 font-medium')}>
                <a.icon className="h-4 w-4" /> {a.label}
              </Link>
            ))}
            {user.mustEnable2fa && (
              <Link href="/account?setup2fa=1" className="mt-4 flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-warning">
                <Shield className="h-4 w-4" /> Enable 2FA
              </Link>
            )}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <InstallPrompt />
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation: pastors mostly use phones (§11.2). */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur safe-bottom lg:hidden">
        <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}>
          {mobileNav.map((n) => (
            <Link key={n.href} href={n.href} className={cn('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', active(n.href) ? 'text-brand' : 'text-muted')}>
              <n.icon className="h-5 w-5" />
              {n.href === '/announcements' && !!unread.data && <span className="absolute right-[calc(50%-14px)] top-1.5 h-2 w-2 rounded-full bg-brand" aria-label="Unread announcements" />}
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
