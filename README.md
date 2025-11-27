# ChatMail Backend

Backend server for ChatMail - Real-time messaging platform

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration

4. Start MongoDB locally or use MongoDB Atlas

5. Run the server:
```bash
npm run dev
```

## API Endpoints

### Authentication
- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - Login user
- POST `/api/auth/logout` - Logout user

### User
- GET `/api/user/profile` - Get user profile
- PUT `/api/user/profile` - Update profile
- GET `/api/user/search?email=xxx` - Search users
- GET `/api/user/:id` - Get user by ID
- PUT `/api/user/status` - Update status

### Chat
- POST `/api/chat/send` - Send message
- GET `/api/chat/history/:userId` - Get chat history
- GET `/api/chat/conversations` - Get recent conversations
- PUT `/api/chat/read` - Mark messages as read

## Socket.IO Events

### Client → Server
- `message:send` - Send message
- `typing:start` - Start typing
- `typing:stop` - Stop typing
- `message:read` - Mark message as read

### Server → Client
- `message:receive` - Receive message
- `message:sent` - Message sent confirmation
- `typing:user` - User typing status
- `user:online` - User came online
- `user:offline` - User went offline
- `message:status` - Message status update
