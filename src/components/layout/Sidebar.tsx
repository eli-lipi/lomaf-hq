'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Upload, Trophy, BarChart3, Settings, Menu, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  children?: { href: string; label: string }[];
}

const NAV_ITEMS: NavItem[] = [
  { href: '/upload', label: 'Data Upload', icon: Upload },
  {
    href: '/pwrnkgs',
    label: 'PWRNKGs',
    icon: Trophy,
    children: [
      { href: '/pwrnkgs?tab=this-week', label: 'This Week' },
      { href: '/pwrnkgs?tab=previous', label: 'Previous Weeks' },
    ],
  },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav className="hidden lg:flex w-60 shrink-0 h-screen sticky top-0 bg-sidebar flex-col">
        <SidebarContent pathname={pathname} />
      </nav>
    </>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['/pwrnkgs', '/analytics']));

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
      <div className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon, children }) => {
          const isActive = pathname.startsWith(href);
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
                  {children.map((child) => {
                    const childActive = pathname + (typeof window !== 'undefined' ? window.location.search : '') === child.href ||
                      (pathname === '/pwrnkgs' && child.href.includes('tab=this-week') && !pathname.includes('previous'));
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        className={cn(
                          'block px-3 py-1.5 rounded text-xs font-medium transition-colors',
                          childActive
                            ? 'text-white bg-white/5'
                            : 'text-sidebar-foreground hover:text-white'
                        )}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-sidebar-foreground text-xs">2026 Season</p>
      </div>
    </>
  );
}
