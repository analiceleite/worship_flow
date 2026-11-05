# SPEC — WF-34: Versões e comunicação de melhorias

**Status:** Decisões de produto fechadas; refinamento técnico pendente  
**PBI:** [WF-34] Versionar releases e comunicar melhorias dentro do Worship Flow  
**Branch:** `feature/wf-34-release-notes`

## 1. Contexto

Precisamos identificar de forma rastreável o que está publicado e comunicar melhorias que impactam a experiência sem depender de grupos externos, como WhatsApp. A comunicação deve informar o benefício para a pessoa, sem interromper o uso normal do sistema.

Ainda não validamos com usuários a frequência ideal nem quais tipos de mudança merecem destaque. Portanto, a primeira entrega deve ser simples e evitar notificações excessivas.

## 2. Objetivos

- Identificar a versão efetivamente implantada e facilitar suporte/rastreabilidade.
- Disponibilizar um histórico de novidades dentro do Worship Flow.
- Destacar novidades relevantes de maneira discreta e registrar quais foram vistas.
- Publicar uma novidade somente depois que a funcionalidade estiver implantada e verificada.
- Preservar isolamento entre igrejas e permissões existentes.

## 3. Fora de escopo inicial

- Painel administrativo para editar novidades.
- Envio automático de e-mail ou notificações push para cada publicação.
- Modal obrigatório para novidades comuns.
- Comunicar toda correção técnica aos usuários.
- Garantir que uma versão por si só represente disponibilidade em todos os ambientes sem confirmação da implantação.

## 4. Proposta inicial

1. Adotar versões rastreáveis, preferencialmente SemVer (`MAJOR.MINOR.PATCH`), com releases/tags associadas às implantações.
2. Exibir a versão implantada em uma área discreta de informações/suporte.
3. Manter as notas de novidades versionadas junto ao código inicialmente, sem painel administrativo.
4. Criar uma central de novidades com título, data, benefício em linguagem simples e link de destino opcional.
5. Mostrar um indicador discreto de novidade não lida; não abrir modal automaticamente.
6. Registrar leitura por usuário, garantindo que o estado acompanhe a conta em seus dispositivos.
7. Permitir segmentação por perfil somente se houver necessidade validada e respeitando o isolamento por igreja.
8. Usar orientações contextuais ou banners apenas para mudanças de fluxo ou avisos urgentes, conforme regras a definir.

## 5. Perfis e necessidades

- **Integrante:** entender melhorias relevantes para suas tarefas, sem interrupções desnecessárias.
- **Administrador da igreja:** receber informação específica de recursos e mudanças administrativas.
- **Suporte/equipe do produto:** identificar a versão implantada e consultar o histórico publicado.

## 6. Requisitos funcionais propostos

- RF-01: A aplicação deve expor a versão efetivamente implantada.
- RF-02: Usuários autenticados devem poder consultar as novidades publicadas.
- RF-03: Cada novidade deve conter, no mínimo, título, data e descrição orientada ao benefício do usuário.
- RF-04: Uma novidade pode ter um destino interno opcional.
- RF-05: A interface deve indicar novidades não lidas sem bloquear tarefas.
- RF-06: O usuário deve poder marcar uma novidade como lida; a regra de leitura entre dispositivos será decidida abaixo.
- RF-07: Novidades não publicadas ou futuras não podem aparecer para usuários.
- RF-08: A segmentação, caso habilitada, deve respeitar perfil e igreja/tenant.
- RF-09: A publicação de uma novidade deve estar associada a uma versão/release e ocorrer somente após verificação da implantação.

## 7. Requisitos de qualidade

- A central deve funcionar em telas móveis e com teclado/leitor de tela.
- Estados vazio, carregando e erro devem ser compreensíveis.
- O indicador não deve reaparecer indevidamente após leitura.
- A solução não deve expor conteúdo ou estado de leitura entre igrejas.
- As notas devem evitar dados pessoais, detalhes internos e linguagem de commit.
- A solução inicial deve minimizar dependências operacionais e trabalho editorial.

## 8. Critérios de aceite preliminares

- [ ] A versão exibida corresponde ao artefato/implantação em execução, não apenas ao branch ou ambiente de build.
- [ ] Existe uma central acessível com novidades publicadas e ordenadas de forma previsível.
- [ ] O usuário entende o benefício e consegue abrir o destino relacionado quando disponível.
- [ ] O indicador de novidade não bloqueia navegação e desaparece segundo a regra de leitura aprovada.
- [ ] Usuários de igrejas diferentes não acessam estado ou conteúdo não autorizado de outra igreja.
- [ ] Não há anúncio de novidade antes da implantação e verificação.
- [ ] A experiência é validada em mobile e com acessibilidade básica.
- [ ] Testes cobrem ausência de novidades, novidade não lida, leitura e isolamento por igreja/perfil.

## 9. Decisões em aberto

| ID | Decisão | Recomendação inicial | Estado |
|---|---|---|---|
| D-01 | Política de versão e ponto de partida | SemVer; iniciar em `1.0.0` | Decidida |
| D-02 | Como determinar a versão em execução | Injetar SemVer no build e associar ao processo de deploy; confirmar disponibilidade com smoke check | Decidida |
| D-03 | Onde mostrar a versão | Área “Sobre”/perfil, de forma discreta | Decidida |
| D-04 | Quem pode ver as novidades | Todos os usuários autenticados, sem segmentação por perfil | Decidida |
| D-05 | Escopo dos comunicados | Novidades globais no MVP; sem segmentação por igreja | Decidida |
| D-06 | O que significa “lida” | Abrir a central marca como lidas as novidades visíveis naquele momento; persistir por usuário e sincronizar entre dispositivos | Decidida |
| D-07 | Conteúdo e armazenamento inicial | Catálogo JSON versionado no repositório, sem tabela/painel | Decidida |
| D-08 | Regras de destaque | MVP somente com central e indicador; incluir melhorias relevantes, sem correções menores, banners ou orientações contextuais | Decidida |
| D-09 | Publicação | Nota incluída no mesmo deploy da funcionalidade; checklist de release e smoke check do deploy | Decidida |
| D-10 | Retenção e arquivamento | Manter histórico sem limite inicial; reavaliar paginação/arquivo se o volume justificar | Decidida |

## 10. Questões para decidir

Decisões fechadas em 2026-11-05; não há questões de produto bloqueadoras restantes.

## 11. Dependências e relações

- WF-09 — fila de notificações confiável e observável; relacionada apenas se futuramente houver e-mail/push.
- WF-31 — validar jornadas com usuários; apoiar validação de descoberta e conteúdo.
- WF-32 — regras de publicação e responsabilidades; definir quem aprova/publica notas.
- WF-33 — linha de base e critérios de sucesso; apoiar medição de adoção/descoberta.

## 12. Métricas a considerar

Não definir metas numéricas sem linha de base. Após a primeira versão, considerar:

- proporção de usuários elegíveis que visualizaram novidades relevantes;
- uso dos links/destinos associados às novidades;
- feedback qualitativo sobre clareza e excesso de avisos;
- tickets/perguntas relacionados a mudanças que poderiam ter sido comunicadas.

## 13. Registro de decisões

Decisões aprovadas serão registradas nesta seção com data, decisão e justificativa. Até lá, os itens acima são propostas, não requisitos fechados.

- **2026-11-05 — D-01:** Adotar SemVer e iniciar a linha formal em `1.0.0`. O sistema já está sendo usado em produção; as próximas releases devem avançar patch para correções compatíveis e minor para melhorias compatíveis. Major fica reservado para mudanças incompatíveis que exijam adaptação.
- **2026-11-05 — D-05:** A central será global no MVP, igual para todas as igrejas. Segmentação por igreja fica fora do primeiro escopo e só deve ser considerada após necessidade validada.
- **2026-11-05 — D-06:** Abrir a central marca como lidas as novidades que estavam visíveis naquele momento. O registro é por usuário e sincronizado entre dispositivos; novidades publicadas depois devem voltar a aparecer como não lidas. Abrir apenas o menu/indicador não conta como leitura.
- **2026-11-05 — D-02:** Injetar SemVer no build e associá-lo ao processo de deploy. A versão identifica o artefato; checklist e smoke check confirmam o deploy, sem tratar a versão isoladamente como prova de disponibilidade.
- **2026-11-05 — D-03:** Exibir a versão discretamente na área “Sobre”/perfil.
- **2026-11-05 — D-04:** Disponibilizar a central para todos os usuários autenticados, sem segmentação por perfil no MVP.
- **2026-11-05 — D-07:** Manter o catálogo em JSON versionado no repositório, sem tabela ou painel administrativo. Cada nota terá ID estável, versão, data, título, resumo orientado ao benefício, destino opcional e estado/data de publicação.
- **2026-11-05 — D-08:** MVP limitado à central e indicador discreto para melhorias relevantes. Correções menores, banners e orientações contextuais ficam fora do escopo inicial.
- **2026-11-05 — D-09:** Incluir a nota no mesmo deploy da funcionalidade, com checklist e smoke check do deploy. A nota deve descrever somente a funcionalidade que acompanha o deploy; se o deploy não for considerado disponível, sua publicação deve ser interrompida/retirada.
- **2026-11-05 — D-10:** Manter o histórico sem limite inicial; reavaliar paginação ou arquivamento quando o volume justificar.
- **2026-11-05 — Baseline de release:** A versão atual é `1.0.0`, incluindo a correção de redefinição de senha do WF-31. O WF-31 entra no histórico como nota da `1.0.0`, sem gerar indicador de não lida. A próxima release que incluir a central de novidades (WF-34) será `1.1.0`, por se tratar de funcionalidade nova compatível; WF-34 só será adicionado ao catálogo após deploy e verificação.
- **2026-11-05 — Release WF-34:** Após confirmação de deploy e verificação, publicar WF-34 como `1.1.0`; atualizar a versão do pacote e incluir a nota publicada no catálogo.
