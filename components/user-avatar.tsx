'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function UserAvatar({ name, avatarUrl, className }: {
  name: string
  avatarUrl?: string | null
  className?: string
}) {
  const initials = name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()

  return (
    <Avatar className={cn('h-8 w-8 shrink-0 text-3xl', className)}>
      <AvatarImage src={avatarUrl || undefined} alt={`Foto de ${name}`} className="object-cover" loading="lazy" />
      <AvatarFallback className="text-[0.4em] font-medium">{initials || '?'}</AvatarFallback>
    </Avatar>
  )
}
