'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap, Archive, BarChart3, Settings, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/this-week', label: 'This Week', icon: Zap },
  { href: '/published', label: 'Published', icon: Archive },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center gap-3 bg-card border-b border-border px-4 h-14">
        <button onClick={() => setMobileOpen(true)} className="text-muted-foreground hover:text-foreground">
          <Menu size={24} />
        </button>
        <span className="text-primary font-bold text-lg tracking-tight">LOMAF HQ</span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setMobileOpen(false)}>
          <nav
            className="w-60 h-full bg-card border-r border-border flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav className="hidden lg:flex w-60 shrink-0 h-screen sticky top-0 bg-card border-r border-border flex-col">
        <SidebarContent pathname={pathname} />
      </nav>
    </>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {/* Branding */}
      <div className="px-5 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-primary font-bold text-xl tracking-tight">LOMAF HQ</h1>
          <p className="text-muted-foreground text-xs mt-0.5">Power Rankings</p>
        </div>
        {onNavigate && (
          <button onClick={onNavigate} className="lg:hidden text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-border" />

      {/* Nav links */}
      <div className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border">
        <p className="text-muted-foreground text-xs">2026 Season</p>
      </div>
    </>
  );
}
