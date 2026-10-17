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
          <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
            <p className="text-xs tracking-[0.18em] text-muted-foreground">FREQTRADE</p>
            <p className="truncate text-sm font-medium">{terminal.bot.name}</p>
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
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <div className="min-w-0">
            <Select value={terminal.bot.id} onValueChange={selectBot}>
              <SelectTrigger className="h-8 w-44" aria-label="切换实盘" data-testid="bot-name">
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
            <p className="truncate px-1 text-xs text-muted-foreground">
              {[config?.strategy, config?.exchange, config?.timeframe].filter(Boolean).join(' · ') || '等待配置'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
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
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid="bot-mode">{config ? (config.dry_run ? '模拟' : '实盘') : '…'}</span>
            <span aria-hidden="true">·</span>
            <span data-testid="bot-state">
              {config?.state === 'running' ? '运行中' : config?.state === 'stopped' ? '已停止' : '未知'}
            </span>
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