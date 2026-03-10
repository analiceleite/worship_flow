'use client'

import { useEffect } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type PwaWindow = Window & {
  __pwaDeferredPrompt?: BeforeInstallPromptEvent
}

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'

    const isSecureOrigin = window.location.protocol === 'https:'

    const shouldRegister = isLocalhost || isSecureOrigin

    if (!shouldRegister) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister()
        })
      })
      return
    }

    const registerServiceWorker = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js')
      } catch (error) {
        console.error('Falha ao registrar service worker:', error)
      }
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      ;(window as PwaWindow).__pwaDeferredPrompt = event as BeforeInstallPromptEvent
      window.dispatchEvent(new CustomEvent('pwa-install-available'))
    }

    const onAppInstalled = () => {
      ;(window as PwaWindow).__pwaDeferredPrompt = undefined
      window.dispatchEvent(new CustomEvent('pwa-installed'))
    }

    registerServiceWorker()

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  return null
}
