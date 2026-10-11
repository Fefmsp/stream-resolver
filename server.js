const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();

// Activation globale du CORS pour toutes les origines
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Route de résolution Puppeteer optimisée (anti-bot & comportement humain)
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled', // Masque l'automatisation
                '--window-size=1280,720'
            ]
        });

        const page = await browser.newPage();

        // Émulation d'un vrai navigateur desktop / TV pour éviter les blocages mobiles stricts
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        // Supprime l'indicateur navigator.webdriver détecté par les anti-bots
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

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

        // Navigation vers la page cible
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

        // Attente active d'un élément vidéo ou d'un bouton de lecture sur la page
        try {
            await page.waitForSelector('video, .vjs-big-play-button, #player, .play-button, iframe', { timeout: 8000 });
            
            // Simulation d'un clic humain sur le lecteur ou le bouton de lecture
            await page.evaluate(() => {
                const btn = document.querySelector('video, .vjs-big-play-button, #player, .play-button, div[class*="play"]');
                if (btn && typeof btn.click === 'function') {
                    btn.click();
                }
            });
            
            // Laisser le temps au réseau de charger le manifeste .m3u8 après le clic
            await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
            console.log(" Élément de lecture non trouvé ou délai dépassé, analyse des requêtes réseau directes...");
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

// Route Proxy sécurisée pour les playlists (.m3u8) et les segments vidéo binaires (.ts)[cite: 3]
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
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
