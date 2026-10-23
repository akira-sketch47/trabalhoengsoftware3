# Contas e perfis no Pontec Vagas

O site funciona de dois jeitos. Você não precisa fazer nada para usar o primeiro.

## 1. Modo demonstração (padrão)

Enquanto `firebase-config.js` tiver valores `YOUR_...`, cadastro, login e perfil funcionam **somente no navegador** de quem usa:

- as contas ficam no `localStorage` (a senha é guardada com PBKDF2 + sal, nunca em texto puro);
- outro navegador ou dispositivo não enxerga essas contas;
- serve para apresentar o projeto e testar a interface, não para contas reais.

Dá para abrir o `index.html` direto no navegador ou publicar no GitHub Pages.

## 2. Contas reais com Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) e cadastre um app Web.
2. Copie a configuração do app Web para `firebase-config.js`, substituindo os valores `YOUR_...`.
3. Em **Authentication → Sign-in method**, ative **E-mail/senha**.
4. Crie o banco **Cloud Firestore**.
5. Em **Firestore Database → Rules**, cole o conteúdo de `firestore.rules` e publique. **Publique de novo se já tinha uma versão antiga**: as regras aceitam os campos do perfil personalizável e a coleção `jobs` para publicação de vagas por empresas.
6. Em **Authentication → Settings → Authorized domains**, confirme que o domínio do GitHub Pages está autorizado.
7. Publique o site por HTTPS. O SDK do Firebase não carrega ao abrir o HTML via `file://`.

Quando a configuração está preenchida, o site passa a usar o Firebase automaticamente e o aviso de "modo demonstração" some.

### Detalhes

- A foto de perfil é recortada em quadrado (256 px) e guardada como imagem pequena (cerca de 20 a 40 KB) dentro do próprio documento do perfil, então **não precisa do Firebase Storage**.
- Se o perfil não puder ser salvo durante o cadastro, a conta recém-criada é removida para você tentar de novo sem ficar com uma conta sem perfil.
- O link "Esqueci minha senha" só aparece no modo Firebase.
- A configuração do app Web contém identificadores públicos. Nunca coloque senhas, chaves de conta de serviço ou outras credenciais privadas no repositório.
- As regras permitem que cada usuário leia e altere apenas o próprio documento `profiles/{uid}`. Vagas em `jobs/{jobId}` podem ser lidas publicamente, mas só empresas autenticadas podem publicar ou remover as próprias vagas.
