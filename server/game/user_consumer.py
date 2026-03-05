import json
from channels.generic.websocket import AsyncWebsocketConsumer

class UserNotificationConsumer(AsyncWebsocketConsumer):
    """Per-user WebSocket for notifications (challenges, friend requests, etc.)"""

    async def connect(self):
        await self.accept()
        
        self.user = self.scope['user']
        
        if not self.user.is_authenticated:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Authentication required - Please pass ?token=YOUR_JWT in WebSocket URL'
            }))
            await self.close()
            return
        
        self.user_group = f"user_{self.user.id}"
        
        await self.channel_layer.group_add(
            self.user_group,
            self.channel_name
        )
        
        # Send connection success
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'user_id': self.user.id,
            'message': 'Successfully connected to notifications'
        }))
    
    async def disconnect(self, close_code):
        if hasattr(self, 'user_group'):
            await self.channel_layer.group_discard(
                self.user_group,
                self.channel_name
            )
    
    async def user_notification(self, event):
        """Handle notification events from Redis/channel layer"""
        await self.send(text_data=json.dumps(event['message']))