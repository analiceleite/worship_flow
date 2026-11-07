'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Music, Users, ListMusic, Menu, LogOut, FileSpreadsheet, BarChart3, Settings, Sparkles, PanelLeftClose, PanelLeftOpen, CircleAlert } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/routes'
import { getActiveNavigationHref } from '@/lib/navigation'
import { canShowMediaNavigation } from '@/lib/schedule/access'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const navigation = [
  {
    name: 'Dashboard',
    description: 'Acompanhar indicadores da alocação da escala',
    href: ROUTES.SCHEDULE_ADMIN_DASHBOARD,
    icon: BarChart3,
    adminOnly: true,
  },
  {
    name: 'Músicas',
    description: 'Visualizar músicas disponíveis',
    href: ROUTES.SONGS,

    icon: Music,
  },
  {
    name: 'Repertório',
    description: 'Visualizar repertório de músicas',
    href: ROUTES.REPERTOIRE,
    icon: ListMusic,
  },
  {
    name: 'Escala',
    description: 'Visualizar escala de ministros de louvor',
    href: ROUTES.SCHEDULE,
    icon: FileSpreadsheet,
  },
  {
    name: 'Novidades',
    description: 'Conheça as melhorias recentes',
    href: ROUTES.RELEASE_NOTES,
    icon: Sparkles,
  },
  {
    name: 'Usuários',
    description: 'Administrar contas e permissões dos usuários',
    href: ROUTES.USERS,
    icon: Users,
    adminOnly: true,
  },
]

export function Header({ desktopMenuCollapsed, onDesktopMenuToggle }: {
  desktopMenuCollapsed: boolean
  onDesktopMenuToggle: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userName, setUserName] = useState<string>('')
  const [userRole, setUserRole] = useState<string>('')
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [impersonatedChurch, setImpersonatedChurch] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [activeChurch, setActiveChurch] = useState<{ id: string; name: string; slug: string; environment?: string } | null>(null)
  const [unreadReleaseNotes, setUnreadReleaseNotes] = useState(0)

  useEffect(() => {
    const updateAvatar = (event: Event) => {
      setUserAvatar((event as CustomEvent<{ avatarUrl: string | null }>).detail.avatarUrl)
    }
    const updateName = (event: Event) => {
      setUserName((event as CustomEvent<{ name: string }>).detail.name)
    }
    window.addEventListener('profile-avatar-updated', updateAvatar)
    window.addEventListener('profile-name-updated', updateName)
    return () => {
      window.removeEventListener('profile-avatar-updated', updateAvatar)
      window.removeEventListener('profile-name-updated', updateName)
    }
  }, [])

  useEffect(() => {
    loadUser()
    loadImpersonation()
    loadActiveChurch()
  }, [])

  useEffect(() => {
    let active = true
    let latestRequest = 0
    const refreshUnreadNotes = async () => {
      const requestId = ++latestRequest
      try {
        const response = await fetch('/api/release-notes', { cache: 'no-store' })
        if (!response.ok) return
        const result = await response.json()
        if (active && requestId === latestRequest) setUnreadReleaseNotes(result.unreadCount ?? 0)
      } catch {
        // Keep the last known indicator when the network is unavailable.
      }
    }
    void refreshUnreadNotes()
    window.addEventListener('release-notes-read', refreshUnreadNotes)
    window.addEventListener('focus', refreshUnreadNotes)
    return () => {
      active = false
      window.removeEventListener('release-notes-read', refreshUnreadNotes)
      window.removeEventListener('focus', refreshUnreadNotes)
    }
  }, [pathname])

  const loadActiveChurch = async () => {
    try {
      const response = await fetch('/api/context')
      if (!response.ok) return
      const result = await response.json()
      setActiveChurch(result.church ?? null)
    } catch {
      setActiveChurch(null)
    }
  }

  const loadImpersonation = async () => {
    try {
      const response = await fetch('/api/platform/impersonation')
      if (!response.ok) return
      const result = await response.json()
      setImpersonatedChurch(result.church ?? null)
    } catch {
      setImpersonatedChurch(null)
    }
  }

  const loadUser = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const { data: minister } = await supabase
        .from('ministers')
        .select('name, role, avatar_url')
        .eq('user_id', user.id)
        .single()

      if (minister) {
        setUserName(minister.name)
        setUserRole(minister.role)
        setUserAvatar(minister.avatar_url)
      }
    }
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(ROUTES.AUTH_LOGIN)
    router.refresh()
  }

  const stopImpersonation = async () => {
    await fetch('/api/platform/impersonation', { method: 'DELETE' })
    setImpersonatedChurch(null)
    router.push('/platform/churches')
    router.refresh()
  }

  const visibleNavigation = navigation.filter(item =>
    // Admin-only pages only visible to admin
    (!item.adminOnly || userRole === 'admin')
    // Mídia consulta repertório e escala publicada, sem gestão administrativa.
    && (userRole !== 'midia' || canShowMediaNavigation(item.href))
  )

  const primaryNavigation = visibleNavigation.filter(item => !item.adminOnly && item.href !== ROUTES.RELEASE_NOTES)
  const secondaryNavigation = visibleNavigation.filter(item => item.href === ROUTES.RELEASE_NOTES)
  const administrationNavigation = visibleNavigation.filter(item => item.adminOnly)
  const activeHref = getActiveNavigationHref(pathname, visibleNavigation)

  const renderNavigationItems = (items: typeof visibleNavigation, mobile = false) => items.map((item) => {
    const isActive = item.href === activeHref
    const isReleaseNotes = item.href === ROUTES.RELEASE_NOTES
    const hasUnreadNotes = isReleaseNotes && unreadReleaseNotes > 0
    const unreadLabel = `${unreadReleaseNotes} novidade${unreadReleaseNotes === 1 ? '' : 's'} não lida${unreadReleaseNotes === 1 ? '' : 's'}`
    return (
      <Link
        key={item.name}
        href={item.href}
        aria-label={hasUnreadNotes ? `${item.name}: ${unreadLabel}` : item.name}
        onClick={mobile ? () => setMobileMenuOpen(false) : undefined}
        title={hasUnreadNotes ? unreadLabel : desktopMenuCollapsed && !mobile ? item.name : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
          isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          desktopMenuCollapsed && !mobile && 'justify-center px-2'
        )}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {(!desktopMenuCollapsed || mobile) && <span className="min-w-0 flex-1 truncate">{item.name}</span>}
        {hasUnreadNotes && <CircleAlert aria-hidden="true" className={cn(
          'h-4 w-4 shrink-0',
          isActive ? 'text-primary-foreground' : 'text-primary',
          desktopMenuCollapsed && !mobile && 'absolute right-0 top-0 rounded-full bg-card'
        )} />}
      </Link>
    )
  })

  return (
    <>
      <aside
        data-wf-sidebar
        data-state={desktopMenuCollapsed ? 'collapsed' : 'expanded'}
        className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-card md:flex', desktopMenuCollapsed ? 'w-16' : 'w-60')}
      >
        <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-border px-4', desktopMenuCollapsed && 'justify-center px-2')}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
            <img src="/logo.jpg" alt="Logo da Igreja" className="h-full w-full object-contain" />
          </div>
          {!desktopMenuCollapsed && <div className="min-w-0"><span className="block truncate text-base font-semibold">Worship Flow</span>{activeChurch && <span className="block truncate text-xs text-muted-foreground">{activeChurch.name}{activeChurch.environment && activeChurch.environment !== 'production' ? ` · ${activeChurch.environment}` : ''}</span>}</div>}
        </div>
        <nav aria-label="Navegação principal" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
          <div className="space-y-1">
            {!desktopMenuCollapsed && <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Principal</p>}
            {renderNavigationItems(primaryNavigation)}
          </div>
          {administrationNavigation.length > 0 && <div className="space-y-1">
            {!desktopMenuCollapsed && <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Administração</p>}
            {renderNavigationItems(administrationNavigation)}
          </div>}
          <div className="mt-auto space-y-1 border-t border-border pt-3">
            {renderNavigationItems(secondaryNavigation)}
            {userName && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" className={cn('h-14 w-full justify-start gap-3 px-3', desktopMenuCollapsed && 'justify-center px-2')} aria-label={`Conta de ${userName}`}>
                <Avatar className="h-8 w-8 shrink-0"><AvatarImage src={userAvatar || undefined} alt={userName} /><AvatarFallback>{userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</AvatarFallback></Avatar>
                {!desktopMenuCollapsed && <span className="min-w-0 text-left"><span className="block truncate text-sm">{userName}</span><span className="block text-xs font-normal text-muted-foreground">{userRole === 'admin' ? 'Administrador' : userRole === 'midia' ? 'Mídia' : 'Ministro'}</span></span>}
              </Button></DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="start" side="right" forceMount>
                <DropdownMenuLabel className="font-normal"><div className="flex flex-col space-y-1"><p className="text-sm font-medium">{userName}</p><p className="text-xs text-muted-foreground">{userRole === 'admin' ? 'Administrador' : userRole === 'midia' ? 'Mídia' : 'Ministro'}</p></div></DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href={ROUTES.PROFILE} className="cursor-pointer"><Settings className="mr-2 h-4 w-4" />Meu Perfil</Link></DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
        </nav>
        <div className="border-t border-border p-2">
          <Button variant="ghost" size="icon" className="h-11 w-full" onClick={onDesktopMenuToggle} aria-expanded={!desktopMenuCollapsed} aria-label={desktopMenuCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} title={desktopMenuCollapsed ? 'Expandir menu' : 'Recolher menu'}>
            {desktopMenuCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>
        </div>
      </aside>
      <header className="sticky top-0 z-40 border-b border-border bg-card">
      {impersonatedChurch && (
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <span>Impersonando: <strong>{impersonatedChurch.name}</strong></span>
            <button className="font-semibold underline" onClick={stopImpersonation}>Encerrar</button>
          </div>
        </div>
      )}
      <nav className="mx-auto px-4 sm:px-6 md:hidden">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
              <img src="/logo.jpg" alt="Logo da Igreja" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <span className="block text-xl font-semibold leading-tight text-foreground">Worship Flow</span>
              {activeChurch && (
                <span className="block max-w-[180px] truncate text-xs text-muted-foreground sm:max-w-[260px]">
                  {activeChurch.name}
                  {activeChurch.environment && activeChurch.environment !== 'production' ? ` · ${activeChurch.environment}` : ''}
                </span>
              )}
            </div>
          </div>

          {/* Mobile menu button */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="md:hidden overflow-y-auto p-0 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:top-1 [&>button]:right-1">
              <SheetHeader className="shrink-0 border-b border-border pr-12">
                <SheetTitle className="text-left">Worship Flow</SheetTitle>
              </SheetHeader>

              <div className="flex shrink-0 flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {activeChurch && <p className="truncate text-xs text-muted-foreground">{activeChurch.name}</p>}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Principal</p>
                  <div className="flex flex-col gap-1">{renderNavigationItems(primaryNavigation, true)}</div>
                </div>
                {administrationNavigation.length > 0 && <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Administração</p>
                  <div className="flex flex-col gap-1">{renderNavigationItems(administrationNavigation, true)}</div>
                </div>}
                {secondaryNavigation.length > 0 && <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mais</p>
                  <div className="flex flex-col gap-1">{renderNavigationItems(secondaryNavigation, true)}</div>
                </div>}

                {userName && (
                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conta</p>
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={userAvatar || undefined} alt={userName} />
                        <AvatarFallback>
                          {userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{userName}</p>
                        <p className="text-xs text-muted-foreground">
                          {userRole === 'admin' ? 'Administrador' : userRole === 'midia' ? 'Mídia' : 'Ministro'}
                        </p>
                      </div>
                    </div>
                    <Link href={ROUTES.PROFILE} className="block">
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <Settings className="mr-2 h-5 w-5" />
                        Meu Perfil
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        handleLogout()
                      }}
                    >
                      <LogOut className="mr-2 h-5 w-5" />
                      Sair
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
      </header>
    </>
  )
}
