from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'^game/(?P<game_id>[^/]+)/$', consumers.GameConsumer.as_asgi()),
    re_path(r'^matchmaking/$', consumers.MatchmakingConsumer.as_asgi()),
    re_path(r'^notifications/$', consumers.UserNotificationConsumer.as_asgi()),
]
