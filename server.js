const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }

    let browser;
    try {
        // Lancement avec un maximum d'arguments de contournement sandbox pour Linux
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
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
                    streamInfo.headers['Referer'] = 'https://vidzy.org/';
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

        try {
            await page.waitForSelector('video, .vjs-big-play-button, #player, .play-button, iframe', { timeout: 8000 });
            await page.click('video, .vjs-big-play-button, #player, .play-button, div[class*="play"]');
            await new Promise(r => setTimeout(r, 5000));
        } catch (err) {}

        await browser.close();

        if (streamInfo.url) {
            res.json(streamInfo);
        } else {
            res.status(404).json({ error: 'Flux vidéo introuvable' });
        }
    } catch (error) {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        console.error("Erreur serveur /resolve:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL manquante' });
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'Referer': 'https://vidzy.org/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Serveur Playwright en écoute sur le port ${PORT}`);
});
