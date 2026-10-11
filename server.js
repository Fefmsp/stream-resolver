const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Route de résolution avec Playwright
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }

    let browser;
    try {
        // Lancement de Chromium via Playwright en mode headless avec options anti-bot
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            locale: 'fr-FR'
        });

        const page = await context.newPage();

        let streamInfo = { url: null, subtitleUrl: null, headers: {} };

        // Interception des requêtes réseau pour capturer le flux et les jetons
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

        // Navigation vers la page cible
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

        // Attente et simulation d'un clic sur le lecteur pour déclencher le chargement du flux
        try {
            await page.waitForSelector('video, .vjs-big-play-button, #player, .play-button, iframe', { timeout: 8000 });
            await page.click('video, .vjs-big-play-button, #player, .play-button, div[class*="play"]');
            
            // Laisser le temps au réseau de capturer le manifeste avec ses jetons
            await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
            console.log(" Élément de lecture non cliquable, écoute passive du réseau...");
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
        res.status(500).json({ error: error.message });
    }
});

// Route Proxy sécurisée pour les playlists et les segments binaires (.ts)
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'Referer': 'https://vidzy.org/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Serveur Playwright en écoute sur le port ${PORT}`);
});
