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
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36');

        let streamInfo = { url: null, subtitleUrl: null, headers: {} };

        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.vtt') || url.includes('.srt') || url.includes('subtitles')) {
                streamInfo.subtitleUrl = url;
            }
            if ((url.includes('.m3u8') || url.includes('.mp4') || url.includes('.mpd')) && !streamInfo.url) {
                if (!url.includes('google') && !url.includes('static') && !url.includes('analytics')) {
                    streamInfo.url = url;
                    // On récupère les headers de la requête et on force le referer de vidzy
                    streamInfo.headers = request.headers();
                    streamInfo.headers['Referer'] = 'https://vidzy.org/';
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        try {
            await page.evaluate(() => {
                const btn = document.querySelector('video, .vjs-big-play-button, #player, .play-button');
                if (btn && typeof btn.click === 'function') btn.click();
            });
            await new Promise(r => setTimeout(r, 4000));
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
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
