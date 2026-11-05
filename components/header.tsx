'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Music, Users, ListMusic, Menu, LogOut, FileSpreadsheet, BarChart3, Settings, Sparkles } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/theme-toggle'
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

export function Header() {
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
    loadUser()
    loadImpersonation()
    loadActiveChurch()
    const clearReleaseNoteIndicator = () => setUnreadReleaseNotes(0)
    window.addEventListener('release-notes-read', clearReleaseNoteIndicator)
    fetch('/api/release-notes').then(async (response) => {
      if (response.ok) setUnreadReleaseNotes((await response.json()).unreadCount ?? 0)
    }).catch(() => {})
    return () => window.removeEventListener('release-notes-read', clearReleaseNoteIndicator)
  }, [])

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
    // 'midia' users should only see the Repertório page in primary navigation
    && (userRole !== 'midia' || item.href === ROUTES.REPERTOIRE)
  )

  return (
    <header className="sticky top-0 z-50 bg-card border-b border-border">
      {impersonatedChurch && (
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <span>Impersonando: <strong>{impersonatedChurch.name}</strong></span>
            <button className="font-semibold underline" onClick={stopImpersonation}>Encerrar</button>
          </div>
        </div>
      )}
      <nav className="mx-auto px-4 sm:px-6 lg:px-8">
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

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-4">
            <ThemeToggle />
            <div className="flex items-center gap-1">
              {visibleNavigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.name}</span>
                    {item.href === ROUTES.RELEASE_NOTES && unreadReleaseNotes > 0 && <span aria-label={`${unreadReleaseNotes} novidades não lidas`} className="h-2 w-2 rounded-full bg-primary" />}
                  </Link>
                )
              })}
            </div>

            {userName && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={userAvatar || undefined} alt={userName} />
                      <AvatarFallback>
                        {userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{userName}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {userRole === 'admin' ? 'Administrador' : userRole === 'midia' ? 'Mídia' : 'Ministro'}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Meu Perfil
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Mobile menu button */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="md:hidden p-0">
              <SheetHeader className="border-b border-border">
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>

              <div className="space-y-4 p-4">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Aparência
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Tema</p>
                      <p className="text-xs text-muted-foreground">
                        Alterne entre modo claro e escuro
                      </p>
                    </div>
                    <ThemeToggle />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Navegação
                  </p>
                  <div className="flex flex-col gap-1">
                    {visibleNavigation.map((item) => {
                      const isActive = pathname === item.href
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={cn(
                            'rounded-lg px-4 py-3 transition-colors',
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <item.icon className="h-5 w-5 shrink-0" />
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-sm font-medium leading-none">{item.name}{item.href === ROUTES.RELEASE_NOTES && unreadReleaseNotes > 0 && <span aria-label="Novidades não lidas" className="h-2 w-2 rounded-full bg-primary" />}</p>
                              <p
                                className={cn(
                                  'mt-1 text-xs',
                                  isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                                )}
                              >
                                {item.description}
                              </p>
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {userName && (
                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Conta
                    </p>
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
                    <Link href="/profile" className="block">
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
  )
}
