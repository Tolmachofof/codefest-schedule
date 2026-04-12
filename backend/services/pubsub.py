import asyncio

_subscribers: dict[int, set[asyncio.Queue]] = {}


def notify(conference_id: int) -> None:
    for q in _subscribers.get(conference_id, set()):
        try:
            q.put_nowait("update")
        except asyncio.QueueFull:
            pass
