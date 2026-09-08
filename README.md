# FLUX

Digital Banking Platform

## Sobre o projeto

Flux é uma plataforma de banking digital full stack criada como projeto de portfólio e estudo. O sistema reúne operações financeiras, cartão, empréstimos, metas, autenticação e recursos de segurança em uma interface web conectada a uma API própria.

Este é um projeto educacional. A Flux não representa um banco real, uma instituição financeira ou um produto comercial em operação.

## Principais funcionalidades

- **PIX:** envio de transferências entre contas, com validações, idempotência e análise de risco.
- **Cartão:** cartão virtual, compras, limite disponível, faturas, pagamento e bloqueio/desbloqueio.
- **Empréstimos:** simulação, solicitação, contratação de empréstimo aprovado e pagamento integral de parcelas.
- **Metas financeiras:** criação, edição, aportes, retiradas, pausa, conclusão e exclusão segura.
- **Controle financeiro:** saldo, movimentações e extrato da conta.
- **Notificações:** notificações por usuário, contador de não lidas, leitura individual e leitura em lote.
- **Alertas:** preferências configuráveis para eventos de segurança, PIX, saldo e empréstimos.
- **Flux Security:** histórico de acessos, sessões, dispositivos e análise de sinais de segurança.
- **Autenticação:** cadastro, login, validação de senha e confirmação de e-mail.
- **Sessões e dispositivos:** listagem, identificação, revogação individual, revogação por dispositivo e encerramento de outras sessões.
- **Verificação de e-mail:** confirmação, reenvio e tokens com expiração e uso único.
- **Recuperação de senha:** solicitação e redefinição por token expirável e de uso único.
- **Troca de e-mail:** solicitação e confirmação do novo endereço por token.

## Segurança

- Autenticação baseada em JWT com `sub` e `sid` vinculados a uma sessão persistida.
- Revogação de sessões no logout, na troca de senha, no reset de senha e pelo gerenciamento de sessões.
- `JWT_SECRET` obrigatório para inicialização da API.
- Senhas armazenadas com hash usando `bcrypt`.
- Tokens de e-mail e recuperação gerados com `randomBytes`, persistidos somente como hash SHA-256, com expiração e consumo concorrente protegido.
- Validação global de entrada com `ValidationPipe`, whitelist e rejeição de propriedades não permitidas.
- Operações financeiras críticas executadas com transações Prisma e verificações de propriedade por usuário.
- Idempotência implementada para PIX e movimentações de metas, com chave e hash da operação.
- Deduplicação e reprocessamento de notificações por meio de uma outbox persistida.
- Escape de dados fornecidos pelo usuário em renderizações HTML, incluindo metas e templates de e-mail.
- Risk Engine para PIX com sinais objetivos como novo dispositivo, novo destinatário, valor elevado, horário incomum e rede diferente.
- Operações PIX de risco elevado exigem confirmação; operações críticas podem ser bloqueadas antes da movimentação.

O Risk Engine é uma regra determinística baseada em sinais e pesos. Não utiliza inteligência artificial.

## Stack

### Frontend

- HTML
- CSS
- JavaScript vanilla

### Backend

- Node.js
- TypeScript
- NestJS
- Passport e `passport-jwt`
- Swagger / OpenAPI
- Nodemailer

### Banco

- PostgreSQL
- Prisma ORM

### Infraestrutura

- Docker Compose
- PostgreSQL 16 Alpine
- Mailpit para SMTP local e inspeção de e-mails

### Testes

- Node.js built-in test runner (`node --test`)
- Testes unitários
- Testes end-to-end

## Arquitetura

```text
Frontend estático (HTML/CSS/JavaScript)
                    |
                    v
             NestJS API
                    |
                    v
                 Prisma
                    |
                    v
              PostgreSQL
```

A API também integra o SMTP configurado via Nodemailer. No desenvolvimento local, o Docker Compose disponibiliza o Mailpit para receber e visualizar as mensagens enviadas.

## Como executar

### Pré-requisitos

- Node.js e npm
- Docker Desktop com Docker Compose
- Python instalado para servir o frontend estático, ou outro servidor HTTP local equivalente

### 1. Instalar dependências

No PowerShell, a partir da raiz do projeto:

```powershell
cd "C:\Users\xboxa\OneDrive\Área de Trabalho\Flux\flux-api"
npm install
```

### 2. Configurar o ambiente

Ainda em `flux-api`, copie o arquivo de exemplo:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e defina pelo menos um `JWT_SECRET` próprio. Não use credenciais reais no repositório.

### 3. Iniciar PostgreSQL e Mailpit

```powershell
docker compose up -d
```

O PostgreSQL fica disponível na porta `5432`. A interface web do Mailpit fica em `http://localhost:8025`.

### 4. Preparar o Prisma

```powershell
npm run prisma:generate
npm run prisma:migrate
```

### 5. Iniciar a API

Para desenvolvimento:

```powershell
npm run start:dev
```

A API fica em `http://localhost:3333/api` e a documentação Swagger em `http://localhost:3333/docs`.

Para executar a versão compilada:

```powershell
npm run build
npm run start:prod
```

### 6. Servir o frontend

Em outro terminal, na raiz do projeto:

```powershell
cd "C:\Users\xboxa\OneDrive\Área de Trabalho\Flux"
python -m http.server 5500
```

Abra `http://localhost:5500/flux_7.html`. As demais páginas HTML da interface ficam na mesma raiz.

## Variáveis de ambiente

As variáveis principais usadas pela aplicação são:

| Variável | Finalidade |
|---|---|
| `DATABASE_URL` | URL de conexão do PostgreSQL usada pelo Prisma. |
| `JWT_SECRET` | Segredo obrigatório para assinar e validar JWTs. |
| `JWT_EXPIRES_IN` | Expiração do JWT. |
| `PORT` | Porta HTTP da API. |
| `CORS_ORIGIN` | Origens permitidas pelo CORS. |
| `MAIL_HOST` | Host SMTP. |
| `MAIL_PORT` | Porta SMTP. |
| `MAIL_USER` | Usuário SMTP, quando necessário. |
| `MAIL_PASS` | Senha SMTP, quando necessário. |
| `MAIL_SECURE` | Ativação de conexão SMTP segura. |
| `MAIL_FROM` | Remetente dos e-mails. |
| `FRONTEND_URL` | URL usada nos links enviados por e-mail. |

Também existem configurações opcionais para expiração de tokens e sessões, intervalo de atualização de sessões, notificações de login e segredo de agrupamento de dispositivos: `EMAIL_VERIFY_EXPIRES_IN`, `PASSWORD_RESET_EXPIRES_IN`, `SESSION_EXPIRES_IN`, `SESSION_TOUCH_INTERVAL_MS`, `NOTIFY_LOGIN` e `DEVICE_ID_HASH_SECRET`.

O arquivo `flux-api/.env.example` contém a referência de configuração. O arquivo `.env` local não deve ser versionado.

## E-mail

O sistema usa SMTP via Nodemailer para:

- confirmação e reenvio de verificação de e-mail;
- recuperação de senha;
- confirmação de troca de e-mail.

Em desenvolvimento, o Mailpit permite inspecionar as mensagens sem depender de um provedor SMTP externo.

## Testes

O projeto possui atualmente **152 testes**, distribuídos entre testes unitários e end-to-end.

Para executar a suíte completa:

```powershell
cd "C:\Users\xboxa\OneDrive\Área de Trabalho\Flux\flux-api"
npm test
```

O comando também executa o build da API antes dos testes. Os comandos individuais estão definidos nos scripts `test:*` de `flux-api/package.json`.

## Screenshots

TODO: adicionar screenshots da Landing, Dashboard, PIX, Cartão e Metas.

## Destaques técnicos

- Análise de risco antes da execução de operações PIX.
- JWT associado a sessões persistidas e revogáveis.
- Controle de sessões e dispositivos com hash do identificador de dispositivo.
- Operações financeiras protegidas por transações Prisma e idempotência onde aplicável.
- Tokens de e-mail e recuperação com hash persistido, expiração e consumo único.
- Notificações com deduplicação e outbox para reprocessamento.
- Validação de entrada no backend e proteção contra XSS no frontend e nos e-mails.

## Autor

Alan Henrique
