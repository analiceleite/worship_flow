# WF-34 — Publicação de versão e novidades

1. A versão atual é `1.1.0` (inclui WF-31 e WF-34). Mantenha `package.json` e `NEXT_PUBLIC_APP_VERSION` alinhados no ambiente de build. O valor deve ser definido durante o build, não apenas no runtime.
2. Adicione ao `content/release-notes.json` somente notas que descrevam mudanças incluídas nessa release. Use um `id` imutável e único, data `YYYY-MM-DD`, título, resumo de benefício, versão, `published: true` e, opcionalmente, um caminho interno começando com `/`.
3. Aplique as migrações pendentes, incluindo `scripts/034_release_note_reads.sql`, antes de habilitar a aplicação com esse código.
4. Faça build e deploy; execute smoke checks e confira a versão na área “Sobre” do perfil e a central autenticada.
5. Se o deploy não estiver disponível após a verificação, reverta/interrompa o release e remova ou desative sua nota no próximo artefato disponível. Não publicar notas para funcionalidades que não chegaram ao ambiente.

O catálogo usa data e estado `published` para filtrar conteúdo no servidor. Se `NEXT_PUBLIC_APP_VERSION` não estiver definida, a interface usa a versão SemVer de `package.json`; a configuração explícita deve coincidir com ela no release implantado.

Notas históricas podem usar `notify: false` para permanecerem consultáveis sem reaparecer como não lidas. A nota do WF-31 é o primeiro caso; a nota de WF-34 está publicada com `notify: true` após verificação do deploy `1.1.0`.
