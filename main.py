import asyncio
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from playwright.async_api import async_playwright
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Stockage temporaire en mémoire des cookies et en-têtes capturés pour la session active
active_session_data = {
    "cookies": [],
    "headers": {}
}

@app.get("/resolve")
async def resolve_stream(url: str = Query(...)):
    global active_session_data
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        )
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport={'width': 1280, 'height': 720},
            locale='fr-FR'
        )
        page = await context.new_page()

        captured_stream = None

        def handle_request(request):
            nonlocal captured_stream
            req_url = request.url
            if (".m3u8" in req_url or ".mp4" in req_url) and not captured_stream:
                if "google" not in req_url and "static" not in req_url and "analytics" not in req_url:
                    captured_stream = {
                        "url": req_url,
                        "headers": dict(request.headers)
                    }

        page.on("request", handle_request)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=35000)
            try:
                await page.click('video, .vjs-big-play-button, #player, .play-button, div[class*="play"]', timeout=5000)
            except Exception:
                pass

            for _ in range(15):
                if captured_stream:
                    break
                await asyncio.sleep(1)

            # Récupération des cookies du contexte du navigateur pour authentifier le proxy
            cookies = await context.cookies()
            active_session_data["cookies"] = cookies
            if captured_stream:
                active_session_data["headers"] = captured_stream["headers"]

        except Exception as e:
            await browser.close()
            raise HTTPException(status_code=500, detail=str(e))

        await browser.close()

        if captured_stream:
            return captured_stream
        else:
            raise HTTPException(status_code=404, detail="Flux vidéo introuvable")

@app.get("/proxy")
async def proxy_stream(url: str = Query(...), request: Request = None):
    global active_session_data
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://vidzy.cc/',
        'Origin': 'https://vidzy.cc',
        'Accept': '*/*'
    }
    
    if request and 'range' in request.headers:
        headers['Range'] = request.headers['range']

    # Construction du dictionnaire de cookies capturés par Playwright
    cookies_dict = {c['name']: c['value'] for c in active_session_data.get("cookies", [])}

    async with httpx.AsyncClient(cookies=cookies_dict, follow_redirects=True) as client:
        try:
            resp = await client.get(url, headers=headers)
            
            response_headers = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*"
            }
            if "content-type" in resp.headers:
                response_headers["Content-Type"] = resp.headers["content-type"]
            if "content-range" in resp.headers:
                response_headers["Content-Range"] = resp.headers["content-range"]
            if "accept-ranges" in resp.headers:
                response_headers["Accept-Ranges"] = resp.headers["accept-ranges"]

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=response_headers
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
