import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: 'Worship Flow',
        short_name: 'WorshipFlow',
        description: 'Gerenciamento de repertório musical para ministério de louvor',
        start_url: '/auth/login',
        scope: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        lang: 'pt-BR',
        icons: [
            {
                src: '/logo-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
            },
            {
                src: '/logo-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/logo-180.jpg',
                sizes: '180x180',
                type: 'image/jpeg',
            },
        ],
        screenshots: [
            {
                src: '/screenshot-mobile.svg',
                sizes: '540x960',
                type: 'image/svg+xml',
                label: 'Tela mobile do Worship Flow',
            },
            {
                src: '/screenshot-wide.svg',
                sizes: '1280x720',
                type: 'image/svg+xml',
                label: 'Tela desktop do Worship Flow',
                form_factor: 'wide',
            },
        ],
    }
}
