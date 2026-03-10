'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Music, Users, ListMusic, Menu, X, LogOut, User } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
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
  { name: 'Músicas', href: '/', icon: Music },
  { name: 'Repertório', href: '/repertorio', icon: ListMusic },
  { name: 'Ministros', href: '/ministros', icon: Users, adminOnly: true },
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
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Music className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold text-foreground">Worship Flow</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-4">
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
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden pb-4 space-y-4">
            <div className="flex flex-col gap-1">
              {visibleNavigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.name}
                  </Link>
                )
              })}
            </div>

            {userName && (
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-3 px-4 mb-2">
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
                  variant="ghost"
                  className="w-full justify-start text-muted-foreground hover:text-foreground"
                  onClick={handleLogout}
                >
                  <LogOut className="mr-2 h-5 w-5" />
                  Sair
                </Button>
              </div>
            )}
          </div>
        )}
      </nav>
    </header>
  )
}
