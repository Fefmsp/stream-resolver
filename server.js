const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }

    let browser;
    try {
        console.log("Lancement de Chromium pour l'URL :", targetUrl);
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            locale: 'fr-FR'
        });

        const page = await context.newPage();
        let streamInfo = { url: null, subtitleUrl: null, headers: {} };

        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.vtt') || url.includes('.srt') || url.includes('subtitles')) {
                streamInfo.subtitleUrl = url;
            }
            if ((url.includes('.m3u8') || url.includes('.mp4') || url.includes('.mpd')) && !streamInfo.url) {
                if (!url.includes('google') && !url.includes('static') && !url.includes('analytics')) {
                    streamInfo.url = url;
                    streamInfo.headers = request.headers();
                    streamInfo.headers['Referer'] = 'https://vidzy.cc/';
                    streamInfo.headers['Origin'] = 'https://vidzy.cc';
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

        try {
            await page.waitForSelector('video, .vjs-big-play-button, #player, .play-button, iframe', { timeout: 8000 });
            await page.click('video, .vjs-big-play-button, #player, .play-button, div[class*="play"]');
            await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
            console.log("Note : Élément de clic non trouvé, poursuite de l'écoute réseau.");
        }

        await browser.close();

        if (streamInfo.url) {
            res.json(streamInfo);
        } else {
            res.status(404).json({ error: 'Flux vidéo introuvable dans les requêtes réseau' });
        }
    } catch (error) {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        console.error("ERREUR CRITIQUE /resolve :", error);
        res.status(500).json({ error: error.message });
    }
});

// Route Proxy avec empreinte navigateur complète anti-Cloudflare
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }
    try {
        const fetchHeaders = {
            'Host': new URL(targetUrl).host,
            'Connection': 'keep-alive',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'video',
            'Referer': 'https://vidzy.cc/',
            'Origin': 'https://vidzy.cc',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
        };

        if (req.headers['range']) {
            fetchHeaders['Range'] = req.headers['range'];
        }

        const response = await fetch(targetUrl, { headers: fetchHeaders });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');

        if (response.headers.get('content-range')) {
            res.setHeader('Content-Range', response.headers.get('content-range'));
        }
        if (response.headers.get('accept-ranges')) {
            res.setHeader('Accept-Ranges', response.headers.get('accept-ranges'));
        }

        res.status(response.status);
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Serveur Playwright en écoute sur le port ${PORT}`);
});
