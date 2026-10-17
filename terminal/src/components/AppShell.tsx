import { useEffect, useState } from 'react';
import {
  Bot,
  CandlestickChart,
  CircleDollarSign,
  Cpu,
  History,
  ListFilter,
  Rows3,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { BrandMark } from '@/components/BrandMark';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useListedBots } from '@/hooks/useListedBots';
import { useTerminal } from '@/hooks/useTerminal';
import { useSession } from '@/stores/session';

function DataLag({ updatedAt }: { updatedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = updatedAt == null ? null : Math.max(0, Math.floor((now - updatedAt) / 1000));
  return (
    <Badge variant={seconds != null && seconds > 15 ? 'destructive' : 'outline'} data-testid="bot-state">
      {seconds == null ? '—' : `${seconds} 秒`}
    </Badge>
  );
}

const navItems = [
  { to: '/bots', label: '实盘', icon: Bot },
  { to: '/positions', label: '持仓', icon: Rows3 },
  { to: '/history', label: '历史', icon: History },
  { to: '/chart', label: '图表', icon: CandlestickChart },
  { to: '/profit', label: '盈亏', icon: CircleDollarSign },
  { to: '/balance', label: '余额', icon: Wallet },
  { to: '/pairs', label: '交易对', icon: ListFilter },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/system', label: '系统', icon: Cpu },
];

export function AppShell() {
  const terminal = useTerminal();
  const catalog = useListedBots();
  const selectBot = useSession((state) => state.selectBot);
  const location = useLocation();
  const config = terminal.config;

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <BrandMark className="size-8 shrink-0" />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-[13px] font-medium tracking-[0.16em]">MANIPULATION</p>
              <p className="truncate text-xs text-muted-foreground">{terminal.bot.name}</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>页面</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.to}>
                          <Icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="@container/header flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <Select value={terminal.bot.id} onValueChange={selectBot}>
            <SelectTrigger className="w-48 shrink-0" size="sm" aria-label="切换实盘" data-testid="bot-name">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(catalog.data ?? [terminal.bot]).map((bot) => (
                <SelectItem key={bot.id} value={bot.id} disabled={!bot.online}>
                  {bot.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {config?.strategy ? (
              <Badge variant="outline" title={config.strategy} className="hidden min-w-0 shrink @min-[540px]/header:inline-flex">
                <span className="truncate">{config.strategy}</span>
              </Badge>
            ) : (
              <span className="truncate text-xs text-muted-foreground">等待配置</span>
            )}
            {config?.exchange ? <Badge variant="secondary" className="hidden @min-[760px]/header:inline-flex">{config.exchange}</Badge> : null}
            {config?.timeframe ? <Badge variant="secondary" className="hidden @min-[760px]/header:inline-flex">{config.timeframe}</Badge> : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Badge variant={terminal.online === 'offline' ? 'destructive' : 'secondary'} className="gap-1.5">
              <span
                className={
                  terminal.online === 'online'
                    ? 'size-1.5 rounded-full bg-up'
                    : terminal.online === 'checking'
                      ? 'size-1.5 rounded-full bg-muted-foreground'
                      : 'size-1.5 rounded-full bg-down'
                }
              />
              {terminal.online === 'online' ? '在线' : terminal.online === 'checking' ? '连接中' : '离线'}
            </Badge>
            <Badge variant="outline" data-testid="bot-mode">
              {config ? (config.dry_run ? '模拟' : '实盘') : '…'}
            </Badge>
            <DataLag updatedAt={terminal.dataUpdatedAt} />
          </div>
        </header>
        {terminal.configError ? (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{terminal.configError}</p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}