# ⚠️ Ajustes Importantes Pendentes

## 🚨 CRÍTICO - Fazer ANTES de Testar

## 📧 Envio de Email Não Implementado

O sistema **NÃO envia emails** automaticamente ainda.

**O que fazer**:
- Admin deve enviar senha temporária manualmente ao ministro (WhatsApp/Slack/etc)
- Ministro faz login e define nova senha

**Para implementar envio automático**:
1. Configure Email Provider no Supabase Dashboard:
   - Settings → Auth → Email Templates
   - Escolha provider (SendGrid, Mailgun, SMTP, etc)
2. Use `supabase.auth.resetPasswordForEmail()` para enviar link de ativação

---

## 🔄 Refresh de Dados

Alguns componentes podem precisar de refresh manual após mudanças:

**Exemplo**: Após criar ministro, lista não atualiza automaticamente.

**Solução**: Adicionar `router.refresh()` ou recarregar dados com `fetchData()`.

---

## 🎨 UI/UX Melhorias Pendentes

1. **Loading States**
   - Adicionar skeleton loaders
   - Feedback visual em operações assíncronas

2. **Error Handling**
   - Exibir mensagens de erro amigáveis com Toast
   - Adicionar Sonner para notificações

3. **Validações**
   - Validar URLs (YouTube, cifra)
   - Validar formato de email
   - Prevenir duplicatas

4. **Responsividade**
   - Testar em mobile
   - Ajustar layouts de formulários

---

## 📱 Funcionalidades Core Faltantes

### 1. Dashboard do Ministro

Criar `app/dashboard/page.tsx`:
- Próximos cultos onde está escalado
- Suas músicas mais usadas
- Contadores (total de músicas, cultos participados)

### 2. Filtros no Repertório

Adicionar em `app/repertorio/page.tsx`:
- Filtrar por ministro
- Buscar por música
- Visualização em calendário

### 3. Histórico de Cultos

- Ver repertórios passados
- Copiar repertório antigo para nova data
- Estatísticas de uso de músicas

### 4. Edição de Perfil

Criar `app/perfil/page.tsx`:
- Ministro edita próprio nome/email/avatar
- Upload de avatar
- Trocar senha

---

## 🔒 Segurança - Checklist

- [x] RLS Policies implementadas
- [x] Middleware protegendo rotas
- [x] Validação de roles server-side
- [ ] Rate limiting em APIs
- [ ] CSRF protection
- [ ] Input sanitization
- [ ] SQL injection prevention (usar sempre Supabase client)

---

## 🚀 Deploy

Antes de fazer deploy:

1. **Configurar Domínio**
   - Adicionar URL do domínio em Supabase → Settings → Auth → Site URL
   - Configurar Redirect URLs

2. **Variáveis de Ambiente**
   - Configurar no Vercel/Netlify:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY` (se usar API Route)

3. **Testar Fluxo Completo**
   - Criar ministro
   - Ministro ativar conta
   - Criar música
   - Montar repertório

4. **Email Provider**
   - Configurar SendGrid ou outro
   - Testar envio de emails

---

## 📞 Suporte

Em caso de problemas:

1. Verificar console do browser (F12)
2. Verificar logs do Supabase
3. Verificar terminal do Next.js
4. Consultar `README_IMPLEMENTATION.md`
5. Consultar documentação Supabase: https://supabase.com/docs

---

## ✨ Próxima Sprint (Sugestões)

**Sprint 1 - Core Fixes**
- [ ] API Route para criar ministro
- [ ] Dashboard do ministro
- [ ] Edição de perfil

**Sprint 2 - UX**
- [ ] Toast notifications (Sonner)
- [ ] Loading skeletons
- [ ] Error boundaries

**Sprint 3 - Features**
- [ ] Busca YouTube API
- [ ] Exportar PDF repertório
- [ ] Histórico de cultos

**Sprint 4 - Polish**
- [ ] Testes E2E (Playwright)
- [ ] Mobile optimization
- [ ] Dark mode fixes
