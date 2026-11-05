# Operação da recuperação de senha

## Preparação e publicação

Para validar sem acessar o Supabase produtivo, seguir `docs/local-supabase.md`. No modo local isolado, a entrega é capturada pelo Mailpit; Resend não é utilizado.

Esta mudança ainda precisa de revisão e validação em ambiente seguro. Coordenar a publicação com a responsável pelo produto; não enviar detalhes de segurança ou dados reais para issues, commits, logs ou PRs públicos.

O envio continua no Resend. A geração, expiração e consumo da prova de recuperação passam a ser gerenciados pelo Supabase Auth; não é necessário editar o template de email do Supabase para este fluxo. Não há criação de conta durante a recuperação.

Antes de implantar:

1. Aplicar as migrações anteriores em um ambiente de teste. Revisar e aplicar `scripts/033_password_recovery.sql` nesse ambiente. **O agente não executou esta migração remotamente.**
2. Configurar `APP_BASE_URL` com a origem canônica da aplicação, sem caminho, query ou fragmento; HTTPS obrigatório em produção. `NEXT_PUBLIC_APP_URL` é fallback para instalações existentes. Headers da requisição não definem essa origem.
3. Conferir `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` e `RESEND_FROM` ou `RESEND_FROM_EMAIL`. Não exibir valores em diagnósticos. Remetente deve estar autorizado no Resend.
4. Conferir política de senha e prazo de expiração de OTP/email no Supabase Auth. Recomenda-se uma janela curta, por exemplo 30 minutos, aprovada pela responsável. O texto do email não promete um prazo fixo diferente da configuração efetiva.
5. **Desabilitar click tracking no Resend para emails de autenticação.** Testar o email recebido para garantir que o link/fragments não foi reescrito por rastreadores. Link scanners não devem consumir a prova: abrir a página não confirma a recuperação automaticamente.
6. Validar com contas e caixas de email de teste. Aprovar a configuração e a estratégia de publicação antes de produção.

## Comportamento esperado

- Solicitação válida recebe mensagem neutra. Isso não confirma conta existente nem entrega do email.
- Limites compartilhados por instâncias, por janela de 15 minutos: 3 solicitações por email, 100 globais e 300 tentativas globais de redefinição. São limites iniciais conservadores, não métricas de uso; revisar capacidade conforme volume real. Não há limitação por IP sem uma origem confiável de endereço configurada na infraestrutura.
- Cada prova tem uma reserva atômica de tentativa antes de consultar Auth, impedindo duas submissões simultâneas. Se houver falha após a reserva, pode ser necessário solicitar outro link. A expiração e o consumo definitivo da prova continuam sob responsabilidade do provedor; a reserva não estende sua validade.
- Email contém link para `/auth/reset` com a prova no fragmento. A página remove o fragmento do histórico e o mantém apenas em memória; recarregar a página exige reabrir o email ou pedir novo link.
- A redefinição usa um cliente sem persistência nem cookies da sessão do navegador. Nenhuma sessão de recuperação é devolvida ao navegador.
- Links anteriores precisam ser substituídos por nova solicitação. Requisições no formato anterior não são aceitas.
- Senha rejeitada pela política após a validação da prova pode exigir novo link. Falha de rede após submissão exige verificar se a nova senha funciona antes de repetir a recuperação.
- Contadores indisponíveis bloqueiam a operação com erro temporário. Falha no envio não devolve o link como alternativa; eventos de falha contêm apenas códigos estáticos, sem email, token ou payload do provedor.
- A tabela anterior é preservada, com acesso público revogado e credenciais pendentes aposentadas. Não removê-la nem restaurar credenciais antigas automaticamente.

## Verificações antes do aceite

`pnpm test:recovery` executa testes locais com dependências simuladas, sem emails ou chamadas ao banco. `pnpm exec tsc --noEmit --incremental false` verifica tipos. `pnpm build` verifica a compilação, não autenticação ou banco real. `pnpm lint` depende de ESLint instalado/configurado no projeto.

Em ambiente de teste autorizado, verificar e registrar sem credenciais reais:

- Conta existente, inexistente e email inválido: resposta neutra onde aplicável, sem identificadores ou links secretos no corpo, console ou logs.
- Entrega Resend, remetente, destino canônico, fragmento preservado e política efetiva de expiração.
- Uso válido, reutilização, prazo expirado, prova inválida, duas submissões concorrentes e troca de senha bem-sucedida seguida de login. O teste unitário de concorrência simula o consumo do provedor; **não comprova atomicidade no Supabase implantado**.
- Usuário fora de qualquer primeira página de listagem; geração não utiliza listagem de contas.
- Política de senha mais forte que o mínimo da interface, falha do provedor, timeout e indisponibilidade do banco.
- Dois processos concorrentes consumindo contadores: não ultrapassar o limite autorizado; após expiração, renovar a janela. Anon/authenticated não podem ler/escrever a tabela nem executar a função; service role autorizado pode.
- Credenciais anteriores não utilizáveis. Leitura/escrita pública da tabela anterior bloqueada após migração.
- Celular em largura reduzida, teclado virtual, foco, rótulos, erros anunciados, link aberto em outro navegador e usuário já autenticado. Não sobrescrever sua sessão de navegação existente.
- Ausência de telemetria nas rotas `/auth/` e de parâmetros de recuperação em URLs registradas pela aplicação. Verificar também logs e ferramentas da infraestrutura, não apenas código.

## Implantação e recuperação operacional

A aplicação depende da função e da tabela da migração 033. Planejar uma janela coordenada: aplicar a migração revisada, implantar a aplicação e testar o fluxo antes de liberá-lo. A migração invalida credenciais anteriores deliberadamente; isso não deve ser desfeito. Se houver necessidade de manutenção, desabilitar temporariamente a recuperação na borda durante a janela.

Se a nova versão falhar, preferir manutenção temporária da recuperação ou uma versão de contenção revisada, sem reativar o fluxo anterior. Não fazer rollback automático do código de autenticação nem reabrir permissões para recuperar disponibilidade. Preservar dados históricos e verificar efeitos antes de qualquer reversão de esquema.

Publicação, execução SQL, configuração do Resend/Supabase e validação em produção exigem autorização própria. Este documento não comprova sua execução.
