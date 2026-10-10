const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL manquante' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Simuler un user-agent Android TV / Chrome similaire à votre code Kotlin
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36');

        let streamInfo = { url: null, subtitleUrl: null, headers: {} };

        // Intercepter les requêtes réseau pour capturer le flux et les sous-titres
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.vtt') || url.includes('.srt') || url.includes('srtproxy') || url.includes('subtitles')) {
                streamInfo.subtitleUrl = url;
            }
            if ((url.includes('.m3u8') || url.includes('.mp4') || url.includes('.mpd')) && !streamInfo.url) {
                if (!url.includes('google') && !url.includes('static') && !url.includes('analytics')) {
                    streamInfo.url = url;
                    streamInfo.headers = request.headers();
                }
            }
        });

        // Charger l'URL cible
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 });

        // Tenter un auto-clic sur le bouton de lecture si nécessaire via l'évaluation JS
        try {
            await page.evaluate(() => {
                const btn = document.querySelector('.vjs-big-play-button, #player, .play-button, [role="button"]');
                if (btn) btn.click();
            });
            // Attendre un court instant pour laisser le flux se déclencher après le clic
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) {}

        await browser.close();

        if (streamInfo.url) {
            res.json(streamInfo);
        } else {
            res.status(404).json({ error: 'Flux vidéo introuvable' });
        }

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur résolveur en écoute sur le port ${PORT}`);
});