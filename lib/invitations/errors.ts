export class InvitationError extends Error {
  status: number
  code: string

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'InvitationError'
    this.code = code
    this.status = status
  }
}

const MESSAGES: Record<string, [number, string]> = {
  WF04_FORBIDDEN: [403, 'Você não pode gerenciar convites desta igreja.'],
  WF04_UNAVAILABLE: [404, 'Este recurso não está disponível.'],
  WF04_ALREADY_MEMBER: [409, 'Este e-mail já participa desta igreja.'],
  WF04_ALREADY_ACCEPTED: [409, 'Este convite já foi aceito.'],
  WF04_INVALID_EMAIL: [400, 'Informe um e-mail válido.'],
  WF04_INVALID_ROLE: [400, 'Selecione um papel válido.'],
  WF04_INVALID_NAME: [400, 'Informe o nome do integrante.'],
  WF04_INSTRUMENT_REQUIRED: [400, 'Selecione ao menos uma função musical.'],
  WF04_INVALID_INVITATION: [400, 'Não foi possível preparar o convite.'],
  WF04_EMAIL_MISMATCH: [403, 'A conta conectada não corresponde ao e-mail deste convite.'],
  WF04_INVITATION_EXPIRED: [410, 'Este convite expirou. Peça um novo convite ao administrador.'],
  WF04_INVITATION_UNAVAILABLE: [404, 'Este convite não está mais disponível.'],
  WF04_MEMBERSHIP_SUSPENDED: [403, 'Seu acesso a esta igreja está suspenso. Fale com o administrador.'],
  WF04_IDENTITY_REQUIRED: [401, 'Entre na conta que recebeu o convite.'],
  WF04_RATE_LIMITED: [429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
  WF04_ACCOUNT_EXISTS: [409, 'Já existe uma conta com este e-mail. Entre para aceitar o convite.'],
}

export function invitationError(error: unknown): { status: number; message: string } {
  const raw = error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : ''
  const code = Object.keys(MESSAGES).find(key => raw.includes(key))
  if (code) {
    const [status, message] = MESSAGES[code]
    return { status, message }
  }
  if (/duplicate key|unique constraint|23505/i.test(raw)) {
    return { status: 409, message: 'Já existe um vínculo ou convite para este e-mail.' }
  }
  return { status: 503, message: 'Não foi possível concluir a operação de convite. Tente novamente.' }
}
