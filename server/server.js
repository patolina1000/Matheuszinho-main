const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');

(() => {
    const candidates = [
        path.resolve(__dirname, '.env'),
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '../../.env'),
        path.resolve(__dirname, '../../../.env'),
        path.resolve(process.cwd(), '.env'),
    ];

    for (const envPath of candidates) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath });
            break;
        }
    }
})();
const express = require('express');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

const LOG_LEVEL = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
const LOG_LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE_LOG_LEVEL = LOG_LEVEL_ORDER[LOG_LEVEL] ?? 20;

function log(level, event, fields) {
    const levelValue = LOG_LEVEL_ORDER[level] ?? 20;
    if (levelValue < ACTIVE_LOG_LEVEL) return;

    const payload = {
        ts: new Date().toISOString(),
        level,
        event,
        ...(fields && typeof fields === 'object' ? fields : {}),
    };

    const line = JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
        return;
    }
    if (level === 'warn') {
        console.warn(line);
        return;
    }
    console.log(line);
}

app.use((req, res, next) => {
    const requestIdHeader = req.headers['x-request-id'];
    const requestId = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || crypto.randomUUID();
    req.requestId = String(requestId);
    res.setHeader('x-request-id', req.requestId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        log('info', 'http_request', {
            request_id: req.requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            duration_ms: Math.round(durationMs * 1000) / 1000,
            ip: req.ip,
            user_agent: req.headers['user-agent'],
        });
    });

    next();
});

function httpsPostJson(urlString, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const bodyString = JSON.stringify(body);

        const req = https.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                path: `${url.pathname}${url.search}`,
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Matheuszinho/1.0 (+https://localhost)',
                    'Content-Length': Buffer.byteLength(bodyString),
                },
                timeout: 30000,
            },
            (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    const contentType = String(res.headers['content-type'] || '');
                    const isJson = contentType.includes('application/json');

                    if (!isJson) {
                        resolve({
                            statusCode: res.statusCode || 0,
                            headers: res.headers,
                            data,
                        });
                        return;
                    }

                    try {
                        resolve({
                            statusCode: res.statusCode || 0,
                            headers: res.headers,
                            data: JSON.parse(data),
                        });
                    } catch (err) {
                        reject(err);
                    }
                });
            },
        );

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('WiinPay request timeout'));
        });

        req.write(bodyString);
        req.end();
    });
}

function sanitizeUrlInput(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/[`'"]/g, '').replace(/\s+/g, '').trim();
}

function ensureWebhookPath(urlString) {
    const cleaned = sanitizeUrlInput(urlString);
    if (!cleaned) return '';
    try {
        const url = new URL(cleaned);
        if (!url.pathname || url.pathname === '/' || url.pathname === '') {
            url.pathname = '/api/wiinpay/webhook';
        }
        return url.toString();
    } catch {
        return cleaned;
    }
}

function normalizeWiinpayResponse(data) {
    if (!data || typeof data !== 'object') return data;

    const payload = data.data && typeof data.data === 'object' ? data.data : data;
    if (!payload || typeof payload !== 'object') return data;

    const pickStringKey = (obj, keys) =>
        keys.find((key) => typeof obj?.[key] === 'string' && obj[key].trim().length > 0);

    const qrCodeKey = pickStringKey(payload, [
        'qr_code',
        'qrCode',
        'qrcode',
        'pix_copia_cola',
        'pixCopiaECola',
        'brcode',
        'br_code',
        'emv',
        'copy_paste',
        'pix_copy_paste',
    ]);

    const qrBase64Key = pickStringKey(payload, [
        'qr_code_base64',
        'qrCodeBase64',
        'qrcode_base64',
        'qrCodeImage',
        'qr_code_image',
        'qr_image_base64',
        'qrCodeImageBase64',
        'qrCodeBase64Image',
    ]);

    const normalized = { ...payload };

    if (qrCodeKey && !normalized.qr_code) normalized.qr_code = payload[qrCodeKey];
    if (qrBase64Key && !normalized.qr_code_base64) normalized.qr_code_base64 = payload[qrBase64Key];

    return normalized;
}

app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
});

app.post('/api/wiinpay/pix/create', async (req, res) => {
    try {
        const apiKey = process.env.WIINPAY_API_KEY;
        if (!apiKey) {
            res.status(500).json({ error: 'WIINPAY_API_KEY não configurada no servidor' });
            return;
        }

        const value = Number(req.body?.value);
        const name = String(req.body?.name || '');
        const email = String(req.body?.email || '');
        const description = String(req.body?.description || 'Pagamento PIX');
        const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : undefined;

        if (!Number.isFinite(value) || value < 3) {
            res.status(400).json({ error: 'value inválido (mínimo R$ 3,00)' });
            return;
        }

        if (!name.trim() || !email.trim()) {
            res.status(400).json({ error: 'name e email são obrigatórios' });
            return;
        }

        const explicitWebhookUrl = ensureWebhookPath(process.env.WIINPAY_WEBHOOK_URL);
        const publicBaseUrl = sanitizeUrlInput(
            process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || process.env.WIINPAY_PUBLIC_BASE_URL || '',
        ).replace(/\/+$/, '');
        const webhookUrl = explicitWebhookUrl || (publicBaseUrl ? `${publicBaseUrl}/api/wiinpay/webhook` : '');

        if (!webhookUrl) {
            res.status(500).json({
                error: 'Webhook não configurado',
                details: 'Configure WIINPAY_WEBHOOK_URL ou deixe o Render fornecer RENDER_EXTERNAL_URL',
            });
            return;
        }

        if (!/^https?:\/\//i.test(webhookUrl)) {
            res.status(500).json({
                error: 'Webhook inválido',
                details: 'webhook_url precisa começar com http(s)://',
            });
            return;
        }

        if (/wiinpay\.com\.br/i.test(webhookUrl)) {
            res.status(500).json({
                error: 'Webhook inválido',
                details: 'WIINPAY_WEBHOOK_URL deve apontar para o seu servidor, não para domínio da WiinPay',
            });
            return;
        }

        const wiinpayBody = {
            api_key: apiKey,
            value,
            name,
            email,
            description,
            webhook_url: webhookUrl,
            ...(metadata ? { metadata } : {}),
        };

        log('info', 'wiinpay_create_request', {
            request_id: req.requestId,
            value,
            webhook_url: webhookUrl,
        });

        const startedAt = Date.now();
        const wiinpayResponse = await httpsPostJson('https://api-v2.wiinpay.com.br/payment/create', wiinpayBody);
        const durationMs = Date.now() - startedAt;

        log('info', 'wiinpay_create_response', {
            request_id: req.requestId,
            wiinpay_status: wiinpayResponse.statusCode,
            duration_ms: durationMs,
        });

        if (wiinpayResponse.statusCode < 200 || wiinpayResponse.statusCode >= 300) {
            res.status(502).json({
                error: 'Falha ao criar pagamento na WiinPay',
                wiinpay_status: wiinpayResponse.statusCode,
                wiinpay_response: wiinpayResponse.data,
            });
            return;
        }

        const normalizedResponse = normalizeWiinpayResponse(wiinpayResponse.data);
        const responseKeys =
            normalizedResponse && typeof normalizedResponse === 'object' ? Object.keys(normalizedResponse) : [];

        log('info', 'wiinpay_create_response_payload', {
            request_id: req.requestId,
            keys: responseKeys,
            qr_code_length:
                typeof normalizedResponse?.qr_code === 'string' ? normalizedResponse.qr_code.length : 0,
            qr_code_base64_length:
                typeof normalizedResponse?.qr_code_base64 === 'string' ? normalizedResponse.qr_code_base64.length : 0,
        });

        res.status(200).json(normalizedResponse);
    } catch (err) {
        log('error', 'wiinpay_create_error', {
            request_id: req.requestId,
            message: String(err?.message || err),
            stack: err?.stack,
        });
        res.status(500).json({ error: 'Erro interno ao criar Pix', details: String(err?.message || err) });
    }
});

app.post('/api/wiinpay/webhook', (req, res) => {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const statusRaw = payload.status;
    const statusNormalized = typeof statusRaw === 'string' ? statusRaw.toLowerCase() : statusRaw;

    log('info', 'wiinpay_webhook_received', {
        request_id: req.requestId,
        status_raw: statusRaw,
        status: statusNormalized,
        id: payload.id,
    });

    res.status(200).json({ ok: true, status: statusNormalized });
});

// --- SERVIR FRONTEND ---
// Serve arquivos estáticos da pasta pai (Pagina_privacy)
app.use(express.static(path.join(__dirname, '../')));

// Todas as outras requisições retornam o index.html (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    log('info', 'server_started', { port: PORT });
});

process.on('unhandledRejection', (reason) => {
    log('error', 'unhandled_rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
    log('error', 'uncaught_exception', { message: String(err?.message || err), stack: err?.stack });
});
