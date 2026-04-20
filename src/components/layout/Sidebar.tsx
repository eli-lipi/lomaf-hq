'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trophy, BarChart3, ArrowLeftRight, Settings, Menu, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { AppUser } from '@/lib/auth';
import UserMenu from './UserMenu';

interface NavChild {
  href: string;
  label: string;
  adminOnly?: boolean;
  children?: { href: string; label: string; adminOnly?: boolean }[];
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  adminOnly?: boolean;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/pwrnkgs',
    label: 'PWRNKGs',
    icon: Trophy,
    children: [
      {
        href: '/pwrnkgs?tab=this-week',
        label: 'This Week',
        adminOnly: true,
        children: [
          { href: '/pwrnkgs?tab=this-week&sub=layout', label: 'Slide Layout', adminOnly: true },
          { href: '/pwrnkgs?tab=this-week&sub=rankings', label: 'Rankings Editor', adminOnly: true },
          { href: '/pwrnkgs?tab=this-week&sub=preview', label: 'Preview & Publish', adminOnly: true },
        ],
      },
      { href: '/pwrnkgs?tab=previous', label: 'Previous Weeks' },
    ],
  },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    children: [
      { href: '/analytics?tab=overview', label: 'Overview' },
      { href: '/analytics?tab=range', label: 'Round Range' },
      { href: '/analytics?tab=lines', label: 'Line Rankings' },
      { href: '/analytics?tab=luck', label: 'Luck & Form' },
      { href: '/analytics?tab=draft', label: 'Draft vs Reality' },
      { href: '/analytics?tab=players', label: 'Player Rankings' },
      { href: '/analytics?tab=concentration', label: 'AFL Concentration' },
      { href: '/analytics?tab=stability', label: 'Team Stability' },
    ],
  },
  {
    href: '/trades',
    label: 'Trades',
    icon: ArrowLeftRight,
    adminOnly: true,
    children: [
      { href: '/trades?tab=tracking', label: 'Trade Tracking', adminOnly: true },
      { href: '/trades?tab=recommendations', label: 'Trade Recommendations', adminOnly: true },
    ],
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    adminOnly: true,
    children: [
      { href: '/settings?tab=upload', label: 'Data Upload', adminOnly: true },
      { href: '/settings?tab=photos', label: 'Coach Photos', adminOnly: true },
      { href: '/settings?tab=adjustments', label: 'Score Adjustments', adminOnly: true },
      { href: '/settings?tab=users', label: 'Users', adminOnly: true },
      { href: '/settings?tab=info', label: 'League Info', adminOnly: true },
    ],
  },
];

function filterNav(items: NavItem[], isAdmin: boolean): NavItem[] {
  return items
    .filter((item) => (item.adminOnly ? isAdmin : true))
    .map((item) => ({
      ...item,
      children: item.children
        ?.filter((child) => (child.adminOnly ? isAdmin : true))
        .map((child) => ({
          ...child,
          children: child.children?.filter((sub) => (sub.adminOnly ? isAdmin : true)),
        })),
    }));
}

export default function Sidebar({ user }: { user: AppUser }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = filterNav(NAV_ITEMS, user.role === 'admin');

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center gap-3 bg-sidebar px-4 h-14">
        <button onClick={() => setMobileOpen(true)} className="text-sidebar-foreground hover:text-white">
          <Menu size={24} />
        </button>
        <span className="text-white font-bold text-lg tracking-tight">LOMAF HQ</span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setMobileOpen(false)}>
          <nav
            className="w-60 h-full bg-sidebar flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent items={items} user={user} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav className="hidden lg:flex w-60 shrink-0 h-screen sticky top-0 bg-sidebar flex-col">
        <SidebarContent items={items} user={user} pathname={pathname} />
      </nav>
    </>
  );
}

function SidebarContent({
  items,
  user,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  user: AppUser;
  pathname: string;
  onNavigate?: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (href: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  };

  return (
    <>
      {/* Branding */}
      <div className="px-5 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl tracking-tight">LOMAF HQ</h1>
          <p className="text-sidebar-foreground text-xs mt-0.5">Power Rankings</p>
        </div>
        {onNavigate && (
          <button onClick={onNavigate} className="lg:hidden text-sidebar-foreground hover:text-white">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-white/10" />

      {/* Nav links */}
      <div className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map(({ href, label, icon: Icon, children }) => {
          const isActive = pathname.startsWith(href.split('?')[0]);
          const isExpanded = expandedSections.has(href);
          const hasChildren = children && children.length > 0;

          return (
            <div key={href}>
              <div className="flex items-center">
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={cn(
                    'flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-sidebar-foreground hover:text-white hover:bg-white/5'
                  )}
                >
                  <Icon size={18} />
                  {label}
                </Link>
                {hasChildren && (
                  <button
                    onClick={() => toggleSection(href)}
                    className="p-1.5 text-sidebar-foreground hover:text-white rounded"
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
              </div>
              {hasChildren && isExpanded && (
                <div className="ml-8 mt-0.5 space-y-0.5">
                  {children.map((child) => (
                    <div key={child.href}>
                      <Link
                        href={child.href}
                        onClick={onNavigate}
                        className={cn(
                          'block px-3 py-1.5 rounded text-xs font-medium transition-colors',
                          'text-sidebar-foreground hover:text-white'
                        )}
                      >
                        {child.label}
                      </Link>
                      {/* Third-level children (e.g., This Week sub-tabs) */}
                      {child.children && (
                        <div className="ml-4 mt-0.5 space-y-0.5">
                          {child.children.map((sub) => (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              onClick={onNavigate}
                              className="block px-3 py-1 rounded text-[11px] text-sidebar-foreground/70 hover:text-white transition-colors"
                            >
                              {sub.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: user menu */}
      <div className="px-3 py-3 border-t border-white/10">
        <UserMenu user={user} />
        <p className="text-sidebar-foreground text-[10px] mt-2 px-2">2026 Season</p>
      </div>
    </>
  );
}
