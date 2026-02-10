# Documentação da API WiinPay (Consolidada)

**Endpoint**: `POST https://api.wiinpay.com.br/payment/create`

## Criar Pagamento (PIX)

**Headers**:
```http
Accept: application/json
Content-Type: application/json
```

**Body**:
```json
{
  "api_key": "SUA_CHAVE_API",
  "value": 10.50,               // Valor em REAIS (float). Mínimo R$ 3,00
  "name": "Nome do Cliente",
  "email": "email@cliente.com",
  "description": "Descrição do pedido",
  "webhook_url": "https://seu-site.com/webhook",
  "metadata": {
    "custom_id": "123"
  },
  "split": {                    // Opcional (presente em algumas versões da doc)
    "value": 0.50,
    "percentage": 1,
    "user_id": "1234567890"
  }
}
```

**Observações Importantes**:
1. **Valor**: Deve ser enviado em **REAIS** (ex: `3.50` para R$ 3,50), e não em centavos.
   - O adaptador faz a conversão automática de centavos (sistema) para reais (API).
   - Valor mínimo: R$ 3,00.
2. **Autenticação**: A `api_key` é enviada no **corpo da requisição (body)**, e não no header Authorization.
3. **Webhook**: A URL de notificação deve ser passada no campo `webhook_url` a cada transação.

## Resposta de Sucesso
Status: `201 Created`

```json
{
  "status": "created",
  "id": "...",                // ID da transação
  "qr_code": "...",           // Código PIX Copia e Cola
  "qr_code_base64": "..."     // Imagem do QR Code em Base64
}
```

## Webhook
O gateway envia um POST para a `webhook_url` informada quando o status muda.

**Payload Esperado (Inferido)**:
```json
{
  "id": "...",
  "status": "paid",
  "value": 10.50,
  "payer_name": "Fulano",
  "payer_document": "12345678900"
}
```
