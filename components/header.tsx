'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Music, Users, ListMusic, Menu, LogOut, FileSpreadsheet } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
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
    name: 'Músicas',
    href: '/',
    icon: Music,
  },
  {
    name: 'Repertório',
    href: '/repertorio',
    icon: ListMusic,
  },
  {
    name: 'Escala',
    description: 'Visualizar escala de ministros de louvor',
    href: '/escala',
    icon: FileSpreadsheet,
  },
  {
    name: 'Ministros',
    description: 'Administrar contas e permissões dos ministros',
    href: '/ministros',
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

  useEffect(() => {
    loadUser()
  }, [])

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
    router.push('/auth/login')
    router.refresh()
  }

  const visibleNavigation = navigation.filter(item =>
    !item.adminOnly || userRole === 'admin'
  )

  return (
    <header className="sticky top-0 z-50 bg-card border-b border-border">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary overflow-hidden">
              <img src="/logo.jpg" alt="Logo da Igreja" className="h-full w-full object-contain" />
            </div>
            <span className="text-xl font-semibold text-foreground">Worship Flow</span>
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
                    {item.name}
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
                        {userRole === 'admin' ? 'Administrador' : 'Ministro'}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
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
                            <p className="text-sm font-medium leading-none">{item.name}</p>
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
                          {userRole === 'admin' ? 'Administrador' : 'Ministro'}
                        </p>
                      </div>
                    </div>
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
