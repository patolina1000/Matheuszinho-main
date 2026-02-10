# Deploy no Render

## 1) Subir no GitHub

- Crie um repositório no GitHub
- Faça push deste projeto

## 2) Criar o serviço no Render

- New + → Blueprint
- Selecione o repositório
- O Render vai ler o arquivo `render.yaml` e criar o serviço

## 3) Configurar variáveis de ambiente

Obrigatórias:
- `WIINPAY_API_KEY`

Opcionais:
- `WIINPAY_WEBHOOK_URL` (URL completa do webhook)
- `PUBLIC_BASE_URL` (base pública do app, ex: `https://seu-app.onrender.com`)

Se `WIINPAY_WEBHOOK_URL` não estiver setada, no Render o servidor usa `RENDER_EXTERNAL_URL` automaticamente (e monta `/api/wiinpay/webhook`). `PUBLIC_BASE_URL` é opcional.

## 4) Rotas úteis

- `GET /health` → healthcheck
- `POST /api/wiinpay/pix/create` → cria cobrança PIX
- `POST /api/wiinpay/webhook` → endpoint que recebe notificações
