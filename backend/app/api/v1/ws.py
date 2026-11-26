"""WebSocket Real-Time Gateway API Endpoint.

Allows browser clients to establish bi-directional channels dynamically segmented
by Facility Space or global event streams.
"""

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.app.services.websocket_service import ws_manager
from backend.app.services.esp32_service import handle_esp32_websocket_connection

router = APIRouter(tags=["WebSocket"])
logger = logging.getLogger(__name__)


@router.websocket("/ws/esp32/{space_id}")
@router.websocket("/api/v1/ws/esp32/{space_id}")
async def esp32_hardware_websocket(websocket: WebSocket, space_id: str) -> None:
    """Dedicated Real-Time ESP32-WROOM Hardware Interface with Anti-Spoofing Challenge-Response Authentication."""
    await handle_esp32_websocket_connection(websocket, space_id)


@router.websocket("/ws/{channel}")
async def websocket_endpoint(websocket: WebSocket, channel: str) -> None:
    """Connect to a designated WebSocket channel (e.g. 'global', 'space:sandboxx_0')."""
    await ws_manager.connect(websocket, channel)
    try:
        while True:
            # Keep socket open and accept incoming ping/heartbeat frames
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, channel)
    except Exception as e:
        logger.warning(f"WebSocket session error: {e}")
        ws_manager.disconnect(websocket, channel)
