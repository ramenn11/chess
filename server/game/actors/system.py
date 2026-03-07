import logging
from thespian.actors import ActorSystem

logger = logging.getLogger(__name__)

def get_actor_system():
    """
    Initializes and returns the singleton Thespian ActorSystem.
    Using 'multiprocTCPBase' ensures that all independent Django ASGI workers
    (e.g., Uvicorn/Daphne workers) connect to the exact same actor registry
    instead of spawning their own isolated instances.
    """
    try:
        return ActorSystem("multiprocTCPBase")
    except Exception as e:
        logger.error(f"Failed to initialize ActorSystem: {e}")
        raise