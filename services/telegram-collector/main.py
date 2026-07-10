"""
MARIA SMM OS — Telegram MTProto Stats Collector.

Отдельный контур для расширенной статистики каналов Telegram
(Bot API не даёт channel analytics — см. docs/architecture.md §15).

MTProto-сессия хранится только внутри этого сервиса и никогда
не покидает его. Доступ к API — по bearer-токену TELEGRAM_STATS_TOKEN.

Запуск:
    TELEGRAM_API_ID=... TELEGRAM_API_HASH=... TELEGRAM_SESSION=... \
    TELEGRAM_STATS_TOKEN=... uvicorn main:app --port 8081
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl import functions

API_ID = int(os.environ.get("TELEGRAM_API_ID") or 0)
API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
SESSION = os.environ.get("TELEGRAM_SESSION", "")
TOKEN = os.environ.get("TELEGRAM_STATS_TOKEN", "")

client: TelegramClient | None = None
security = HTTPBearer()


def check_token(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> None:
    if not TOKEN or credentials.credentials != TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global client
    if API_ID and API_HASH and SESSION:
        client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)
        await client.connect()
    yield
    if client:
        await client.disconnect()


app = FastAPI(title="MARIA Telegram Stats Collector", lifespan=lifespan)


class ChannelStatsRequest(BaseModel):
    channel: str  # @username или chat_id


class PostStatsRequest(BaseModel):
    channel: str
    message_id: int


def require_client() -> TelegramClient:
    if client is None or not client.is_connected():
        raise HTTPException(
            status_code=503,
            detail="MTProto session is not configured or disconnected",
        )
    return client


@app.get("/health")
async def health():
    return {
        "status": "ok" if client and client.is_connected() else "no_session",
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/channel-stats", dependencies=[Depends(check_token)])
async def channel_stats(req: ChannelStatsRequest):
    """Снимок канальных метрик. Недоступные значения возвращаются как null."""
    tg = require_client()
    entity = await tg.get_entity(req.channel)

    result: dict = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "followers": None,
        "reach": None,
        "views": None,
        "shares": None,
        "raw": {},
    }

    full = await tg(functions.channels.GetFullChannelRequest(channel=entity))
    result["followers"] = getattr(full.full_chat, "participants_count", None)

    try:
        stats = await tg(
            functions.stats.GetBroadcastStatsRequest(channel=entity, dark=False)
        )
        result["reach"] = getattr(
            getattr(stats, "viewers_per_post", None), "current", None
        )
        result["shares"] = getattr(
            getattr(stats, "shares_per_post", None), "current", None
        )
        result["raw"]["broadcast_stats"] = stats.to_dict()
    except Exception as exc:  # статистика доступна не всем каналам
        result["raw"]["stats_error"] = str(exc)

    return result


@app.post("/post-stats", dependencies=[Depends(check_token)])
async def post_stats(req: PostStatsRequest):
    """Метрики конкретного сообщения: views, forwards, reactions."""
    tg = require_client()
    entity = await tg.get_entity(req.channel)
    messages = await tg.get_messages(entity, ids=[req.message_id])
    msg = messages[0] if messages else None
    if msg is None:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = None
    if msg.reactions and msg.reactions.results:
        reactions = sum(r.count for r in msg.reactions.results)

    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "views": msg.views,
        "forwards": msg.forwards,
        "reactions": reactions,
        "raw": msg.to_dict(),
    }
