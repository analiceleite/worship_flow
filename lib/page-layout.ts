/**
 * Padrão de largura das telas do app.
 *
 * Todas as telas de conteúdo ocupam a largura disponível ao lado do menu, com as mesmas
 * margens laterais, sem limite máximo. Assim nenhuma tela fica mais estreita que as outras
 * no computador. Cada tela adiciona só o espaçamento vertical que precisa (ex.: `py-6`).
 *
 * Exceção: telas de formulário centralizado sem menu (login, convite, redefinição de senha,
 * seleção de igreja) usam cartão estreito de propósito.
 */
export const PAGE_WIDTH = 'mx-auto w-full px-4 sm:px-6 lg:px-8'
