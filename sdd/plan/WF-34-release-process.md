# WF-34 — Publicação de versão e novidades

1. A versão atual é `1.1.0` (inclui WF-31 e WF-34). Mantenha `package.json` e `NEXT_PUBLIC_APP_VERSION` alinhados no ambiente de build. O valor deve ser definido durante o build, não apenas no runtime.
   A próxima release preparada nesta branch é `1.1.1` (WF-07, correção compatível). O pacote e a nova nota já identificam esse artefato; isso não confirma que o deploy foi realizado. Defina `NEXT_PUBLIC_APP_VERSION=1.1.1` no build dessa release e confirme sua disponibilidade após o deploy.
2. Adicione ao `content/release-notes.json` somente notas que descrevam mudanças incluídas nessa release. Use um `id` imutável e único, data `YYYY-MM-DD`, título, resumo de benefício, versão, `published: true` e, opcionalmente, um caminho interno começando com `/`.
3. Aplique as migrações pendentes, incluindo `scripts/034_release_note_reads.sql`, antes de habilitar a aplicação com esse código.
4. Faça build e deploy; execute smoke checks e confira a versão na área “Sobre” do perfil e a central autenticada.
5. Se o deploy não estiver disponível após a verificação, reverta/interrompa o release e remova ou desative sua nota no próximo artefato disponível. Não publicar notas para funcionalidades que não chegaram ao ambiente.

Para `1.1.1`, confirmar a aplicação bem-sucedida de `scripts/036_repertoire_sequences.sql` e o tratamento revisado de duplicatas antes de liberar a aplicação. A nota de WF-07 acompanha o mesmo deploy da correção; conferir sua posição na central e o indicador para contas que já leram as novidades anteriores.

O catálogo usa data e estado `published` para filtrar conteúdo no servidor. Se `NEXT_PUBLIC_APP_VERSION` não estiver definida, a interface usa a versão SemVer de `package.json`; a configuração explícita deve coincidir com ela no release implantado.

Notas históricas podem usar `notify: false` para permanecerem consultáveis sem reaparecer como não lidas. A nota do WF-31 é o primeiro caso; a nota de WF-34 está publicada com `notify: true` após verificação do deploy `1.1.0`.
