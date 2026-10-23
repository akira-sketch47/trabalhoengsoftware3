# Configuracao do Supabase

O portal usa o Supabase para autenticacao, perfis, vagas, favoritos e candidaturas. Os exemplos de vaga embutidos no site sao apenas demonstrativos; vagas publicadas por empresas sao armazenadas no banco e compartilhadas entre visitantes.

## Preparar o projeto

1. Crie um projeto em [supabase.com](https://supabase.com/).
2. No painel **SQL Editor**, execute todo o arquivo `supabase-schema.sql`. Ele cria as tabelas, o perfil automatico no cadastro e as politicas de seguranca (RLS). Se executou uma versao anterior, execute novamente a versao atualizada para corrigir a recursao nas politicas que impedia publicar vagas e candidaturas. Os comandos podem ser executados novamente sem apagar as vagas ou contas existentes.
3. Em **Authentication > Providers > Email**, habilite o provedor e desative **Confirm email** para que a conta seja criada e autenticada sem clicar em um link de confirmação. Se essa opção permanecer ligada, o Supabase não libera a sessão até o e-mail ser confirmado.
   - Se aparecer **email rate limit exceeded**, o serviço de e-mail do projeto atingiu o limite temporário de envio. Aguarde o limite ser liberado e evite repetir o cadastro várias vezes. Se a conta já tiver sido criada, entre pela aba **Entrar**. Para envios confiáveis ou limites maiores, configure um servidor SMTP próprio em **Project Settings > Authentication > SMTP Settings**; isso é uma configuração do projeto Supabase, não algo que o código do site possa contornar.
4. Em **Project Settings > API**, copie a **Project URL** e a chave publica **anon** (tambem chamada publishable key) para `supabase-config.js`.
5. Em **Authentication > URL Configuration**, configure a URL do site e inclua o dominio publicado (e `localhost`, se usar) na lista de redirecionamentos permitidos.
6. Publique o site por HTTPS ou sirva-o em `localhost`. O SDK do Supabase e a autenticacao precisam de conexao.

Exemplo de configuracao:

```js
window.PONTEC_SUPABASE = {
  url: "https://seu-projeto.supabase.co",
  anonKey: "sua-chave-publica-anon"
};
```

Use somente a chave publica `anon`/publishable no navegador. Nunca coloque uma chave `service_role` ou segredo de servidor em arquivos do site.

## Dados armazenados

- `profiles`: perfil de candidato ou empresa, criado automaticamente quando uma conta e cadastrada.
- `jobs`: vagas publicadas por contas de empresa.
- `saved_jobs`: favoritos por usuario.
- `applications`: candidatura e dados de contato do candidato, visiveis somente ao proprio candidato e a empresa dona da vaga.
- `notifications`: avisos dentro do portal para novas candidaturas e decisões da empresa. A empresa pode ver o perfil do candidato depois que ele se candidata; a decisão de aceitar ou recusar é enviada como notificação.

As politicas RLS permitem leitura publica apenas de vagas abertas. Uma funcao restrita verifica o papel e o nome do perfil autenticado sem criar recursao entre as politicas. Empresas autenticadas podem publicar e remover suas proprias vagas, consultar os perfis dos candidatos às próprias vagas e aceitar ou recusar cada candidatura uma vez; candidatos podem se candidatar e consultar o próprio histórico. Notificações são exibidas dentro do portal em tempo real (com o site aberto) e continuam disponíveis ao voltar. O sistema não envia e-mails nem notificações push. A chave pública não substitui essas políticas.

Sem credenciais preenchidas, a pagina mantem as vagas de exemplo e grava favoritos/candidaturas de demonstracao apenas no navegador. Cadastro, login e publicacao reais so funcionam depois de configurar o Supabase e executar o SQL.
