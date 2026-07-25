# 🛰️ CJ RASTREADORES — Sistema Completo (painel + servidor)

Sistema de rastreamento veicular para empresas: painel do dono, painel da empresa,
modo motorista no celular, posições em tempo real e banco de dados persistente.

## O que vem no pacote

```
servidor/
├── server.js          ← o servidor (Node.js)
├── package.json       ← configuração (zero dependências!)
├── public/
│   └── index.html     ← o painel completo (dono + empresa + modo motorista)
└── data.json          ← criado sozinho no 1º uso (banco de dados)
```

## Rodar no seu computador (teste local)

1. Instale o Node.js (versão 18 ou superior): https://nodejs.org
2. Abra o terminal na pasta `servidor/` e rode:
   ```

   npm start
   ```
3. Abra http://localhost:3000 no navegador.

**Login do dono:** `dono@cjrastreadores.com` · senha `admin123`
(mude com as variáveis de ambiente `ADMIN_EMAIL` e `ADMIN_SENHA`)

## Publicar na internet com seu domínio .com

Qualquer hospedagem Node.js funciona. Sugestão gratuita/barata — **Render.com**:

1. Crie uma conta em https://render.com e um **New Web Service**.
2. Envie esta pasta para um repositório GitHub (ou use o deploy por upload).
3. Configure: Build Command: (deixe vazio) · Start Command: `npm start`.
4. Em **Environment**, defina `ADMIN_EMAIL` e `ADMIN_SENHA` com os seus dados.
5. O Render entrega uma URL https:// — teste tudo nela.
6. Em **Settings → Custom Domain**, adicione seu domínio `.com` e siga as
   instruções de DNS no seu registrador. O certificado HTTPS é automático
   (e o HTTPS é obrigatório para o GPS do celular funcionar).

Alternativas: Railway, Fly.io, VPS (Hostinger/Contabo) com `node server.js` + Nginx.

⚠️ **Atenção (Render plano grátis):** o disco é apagado a cada reinício, então o
`data.json` some. Para produção de verdade, use um plano com disco persistente
ou um VPS.

## Como funciona o fluxo completo

1. **Dono** entra, cadastra a empresa cliente e envia login/senha por WhatsApp.
2. **Empresa** entra, ativa o teste grátis de 3 dias e cadastra veículos,
   chips M2, aparelhos GPS e celulares de empregados.
3. Ao cadastrar um celular, o painel gera o link
   `https://seudominio.com/?autorizar=NUMERO` — envie por WhatsApp.
4. **Motorista** abre o link no celular dele, toca em
   “✅ Autorizar e ligar meu GPS” e aceita a permissão de localização.
5. A posição real do aparelho chega ao servidor (`/api/pos`) e é enviada
   **em tempo real** ao painel da empresa (WebSocket). GPS desligado ou sinal
   impreciso (>±250 m) é recusado — o sistema nunca inventa posição.
6. Teste expira → tela de compra (30 dias R$ 39,99 ou anual R$ 399,90) → PIX →
   dono confirma e libera o período.

## Segurança — o que já tem e o que endurecer depois

Já tem: logins com token assinado (HMAC), estado separado por empresa,
posições aceitas só de números cadastrados, filtro de precisão do GPS.

Para endurecer em produção: senhas com hash (bcrypt), token individual por
motorista no link de autorização, HTTPS obrigatório (a hospedagem já dá),
banco PostgreSQL no lugar do data.json e backup automático.

## Próximos passos naturais

- Receptor de rastreadores M2 físicos (protocolos GT06/H02) — porta TCP própria.
- App Android do motorista (Play Store) para rastrear com a tela desligada.
- PIX automático (Mercado Pago/Efí/Asaas) com baixa sem ação do dono.
- Envio de WhatsApp oficial (API) para links e alertas de desvio de rota.
