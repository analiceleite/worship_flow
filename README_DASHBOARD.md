# Dashboard de Alocação — Documentação

## O que é

O Dashboard de Alocação é a tela principal do administrador (`/schedule/admin/dashboard`). Ela consolida em uma única view todos os indicadores importantes sobre o preenchimento das escalas de um trimestre: quem está escalado, quais cultos têm vagas em aberto, quais ministros estão sobrecarregados e quais estão sendo pouco aproveitados.

---

## Como acessar

- **Administrador:** ao abrir o app, é redirecionado automaticamente para o dashboard.
- **Menu:** item "Dashboard" no menu principal (visível apenas para admins).
- **URL direta:** `/schedule/admin/dashboard`

---

## Estrutura da tela

### 1. Seletor de trimestre

No topo da tela há um `<Select>` com todos os trimestres cadastrados. Por padrão, carrega o trimestre **publicado mais recente**. O administrador pode trocar para qualquer outro trimestre e clicar em **Atualizar** para recarregar os dados.

---

### 2. Cards de KPI (4 indicadores)

| Card | O que mede | Verde quando | Vermelho quando |
|---|---|---|---|
| **Cobertura geral** | % de posições preenchidas no trimestre | ≥ 80% | < 30% |
| **Vagas em aberto** | Posições sem nenhum ministro definido | 0 vagas | > 0 vagas |
| **Sobrecarregados** | Ministros com carga > 30% acima da média | Nenhum | ≥ 1 ministro |
| **Aprendizes** | Total de alocações marcadas como trainee | — | — |

---

### 3. Cobertura por Função (gráfico de barras)

Lista cada **função da escala** (ex: Guitarra, Bateria, Vocal etc.) com uma barra horizontal dividida em:
- **Verde** = posições preenchidas
- **Vermelho claro** = posições vazias

Permite identificar de relance qual função está mais carente de ministros no trimestre.

---

### 4. Carga por Ministro (top 10)

Exibe os 10 ministros mais escalados comparados entre si, usando barras horizontais. Cada barra tem dois marcadores verticais:

| Marcador | Cor | O que representa |
|---|---|---|
| Linha laranja | Âmbar | Média de escalas por ministro no trimestre |
| Linha vermelha | Vermelho (70% opacidade) | Limite de sobrecarga (+30% acima da média) |

A barra muda de azul para **vermelho** quando o ministro ultrapassa o limite de sobrecarga.

---

### 5. Alertas de Sobrecarga

Lista os ministros cujo número de alocações ultrapassa **30% acima da média do trimestre**.

Exemplo: se a média do trimestre é 10 escalas por ministro, qualquer um com mais de 16 aparece aqui, com um badge mostrando o quanto está acima (ex: `+73%`).

---

### 6. Eventos com Lacunas

Lista os cultos que ainda têm vagas em aberto, ordenados do maior número de lacunas para o menor. Cada linha mostra:
- Data e tipo do culto (Quinta / Domingo)
- Quais funções estão sem ministro
- Quantidade de vagas em aberto (badge vermelho)

O ponto colorido indica a gravidade:
- 🟢 Verde = sem lacunas
- 🟡 Amarelo = 1 lacuna
- 🔴 Vermelho = 2+ lacunas

---

### 7. Resumo por Evento (tabela)

Tabela com todos os cultos do trimestre, filtrável por **Todos / Domingos / Quintas**. Limita a exibição aos 16 primeiros eventos. Cada linha mostra cobertura e badge de vagas restantes.

---

### 8. Distribuição por Ministro (tabela completa)

Lista os 20 primeiros ministros em ordem decrescente de escalas, com:
- Avatar com iniciais (vermelho = sobrecarregado)
- Nome e instrumento
- Total de escalas no trimestre
- Badges de status:
  - **Sobrecarregado** (vermelho) — acima de 130% da média
  - **Subutilizado** (cinza) — abaixo de 70% da média

---

## Regras de negócio

| Regra | Threshold | Onde muda |
|---|---|---|
| Ministro **sobrecarregado** | `total_assignments > média × 1.6` | `app/api/schedule/admin/analytics/route.ts` linha ~234 |
| Ministro **subutilizado** | `total_assignments < média × 0.7` | `app/api/schedule/admin/analytics/route.ts` linha ~235 |
| Card de cobertura **verde** | ≥ 80% | `app/schedule/admin/dashboard/page.tsx` (KpiCard) |
| Card de cobertura **vermelho** | < 30% | `app/schedule/admin/dashboard/page.tsx` (KpiCard) |

Para alterar o threshold de sobrecarga de 30% para outro valor, edite:
1. O multiplicador `* 1.6` no backend (regra de cálculo)
2. Os textos "30%" no dashboard (exibição para o usuário)

---

## Fonte dos dados

O dashboard consome o endpoint:

```
GET /api/schedule/admin/analytics?quarter_id=<uuid>
```

- **Autenticação:** apenas usuários com `role = 'admin'` têm acesso (retorna 403 caso contrário)
- **Parâmetro opcional:** `quarter_id` — se omitido, usa o trimestre publicado mais recente
- **Tabelas consultadas:** `schedule_quarters`, `schedule_roles`, `ministers`, `schedule_assignments`

---

## Arquivos relevantes

| Arquivo | Responsabilidade |
|---|---|
| [app/api/schedule/admin/analytics/route.ts](app/api/schedule/admin/analytics/route.ts) | Endpoint que agrega e calcula todos os indicadores |
| [app/schedule/admin/dashboard/page.tsx](app/schedule/admin/dashboard/page.tsx) | Página do dashboard (UI, gráficos, tabelas) |
| [lib/routes.ts](lib/routes.ts) | Constante `ROUTES.SCHEDULE_ADMIN_DASHBOARD` |
| [components/header.tsx](components/header.tsx) | Link "Dashboard" no menu (adminOnly) |
| [middleware.ts](middleware.ts) | Redireciona admin de `/` para o dashboard |
