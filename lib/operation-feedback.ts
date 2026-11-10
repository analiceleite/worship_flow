// A successful HTTP response can still represent an unsuccessful email delivery.
export function invitationDeliveryFeedback(status: unknown): { kind: 'success' | 'warning' | 'error'; message: string } {
  if (status === 'sent') return { kind: 'success', message: 'Convite enviado ao serviço de e-mail.' }
  if (status === 'failed') return { kind: 'error', message: 'O convite foi atualizado, mas o envio do e-mail falhou. Confira o status antes de reenviar.' }
  return { kind: 'warning', message: 'Convite atualizado. O envio do e-mail ainda não foi confirmado; confira o status.' }
}

// Invalidate old responses on filter changes, retries and unmount.
export function createLatestRequest() {
  let generation = 0
  return {
    start() {
      const current = ++generation
      return () => current === generation
    },
    invalidate() { generation++ },
  }
}
