"""WebSocket Connection and Channel Management Service.

Dynamically manages WebSocket connections segmented by Facility Space channels
or administrative monitoring feeds.
"""

import json
import logging
from typing import Dict, Set, Any
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages active WebSocket connections grouped dynamically by channel."""

    def __init__(self) -> None:
        # Channels: e.g. "global", "space:sandboxx_0", "space:sandboxx_1", "user:<email>"
        self.active_channels: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        """Register a new client connection to a specified channel."""
        await websocket.accept()
        if channel not in self.active_channels:
            self.active_channels[channel] = set()
        self.active_channels[channel].add(websocket)
        logger.info(f"WebSocket connected to channel '{channel}' (total: {len(self.active_channels[channel])})")

    def disconnect(self, websocket: WebSocket, channel: str) -> None:
        """Remove a disconnected client from the specified channel."""
        if channel in self.active_channels and websocket in self.active_channels[channel]:
            self.active_channels[channel].remove(websocket)
            if not self.active_channels[channel]:
                del self.active_channels[channel]
            logger.info(f"WebSocket removed from channel '{channel}'")

    async def broadcast(self, channel: str, message: Dict[str, Any]) -> None:
        """Broadcast a JSON message to all subscribers of a channel."""
        target_channels = [channel]
        if channel == "global":
            target_channels.append("all")
        elif channel == "all":
            target_channels.append("global")

        payload = json.dumps(message)
        for ch in target_channels:
            if ch not in self.active_channels:
                continue
            dead_sockets = set()
            for ws in self.active_channels[ch]:
                try:
                    await ws.send_text(payload)
                except Exception as e:
                    logger.warning(f"Error broadcasting to WebSocket on channel '{ch}': {e}")
                    dead_sockets.add(ws)

            for dead_ws in dead_sockets:
                self.disconnect(dead_ws, ch)

    async def broadcast_space_event(self, space_slug: str, event_type: str, data: Dict[str, Any]) -> None:
        """Broadcast an event to both the specific space channel and the global feed."""
        message = {
            "space_slug": space_slug,
            "event_type": event_type,
            "data": data,
        }
        await self.broadcast(f"space:{space_slug}", message)
        await self.broadcast("global", message)


# Global singleton instance
ws_manager = WebSocketManager()
