from django.urls import path
from . import views

urlpatterns = [
    path('games/', views.list_games, name='list_games'),
    path('games/<str:game_id>/', views.get_game, name='get_game'),
    path('games/<str:game_id>/moves/', views.get_game_moves, name='game_moves'),
    path('user-games/<str:username>/', views.get_user_games, name='user_games'),

    # Challenge endpoints
    path('challenges/send/', views.send_challenge, name='send_challenge'),
    path('challenges/pending/', views.get_challenges, name='pending_challenges'),
    path('challenges/accept/<int:challenge_id>/', views.accept_challenge, name='accept_challenge'),
    path('challenges/reject/<int:challenge_id>/', views.reject_challenge, name='reject_challenge'),
    path('challenges/<int:challenge_id>/cancel/', views.cancel_challenge, name='cancel_challenge'),

    path('games/live/lobby/', views.get_live_lobby_games, name='live_lobby'),
    path('games/live/<str:game_id>/', views.get_live_game_snapshot, name='live_snapshot'),
]