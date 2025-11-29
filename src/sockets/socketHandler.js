const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');

// Store online users: { userId: socketId }
const onlineUsers = new Map();

module.exports = (io) => {
  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user._id.toString();
      socket.userEmail = user.email;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.userEmail} (${socket.id})`);

    // Add user to online users
    onlineUsers.set(socket.userId, socket.id);

    // Update user status to online
    User.findByIdAndUpdate(socket.userId, { 
      status: 'online',
      lastSeen: Date.now()
    }).exec();

    // Send current online users list to the newly connected user
    socket.emit('users:online', { userIds: Array.from(onlineUsers.keys()) });

    // Broadcast user online status to others
    socket.broadcast.emit('user:online', { userId: socket.userId });

    // Join user's personal room
    socket.join(socket.userId);

    // Handle sending messages
    socket.on('message:send', async (data) => {
      try {
        const { receiverId, content, type = 'text' } = data;

        // Create message in database
        const message = await Message.create({
          sender: socket.userId,
          receiver: receiverId,
          content,
          type
        });

        await message.populate('sender', 'name email avatar');
        await message.populate('receiver', 'name email avatar');

        // Send to receiver if online
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:receive', message);
          
          // Update message status to delivered
          message.status = 'delivered';
          await message.save();
        }

        // Send confirmation to sender
        socket.emit('message:sent', message);

      } catch (error) {
        socket.emit('message:error', { message: error.message });
      }
    });

    // Handle typing indicator
    socket.on('typing:start', (data) => {
      const { receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing:user', {
          userId: socket.userId,
          isTyping: true
        });
      }
    });

    socket.on('typing:stop', (data) => {
      const { receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing:user', {
          userId: socket.userId,
          isTyping: false
        });
      }
    });

    // Handle message read status
    socket.on('message:read', async (data) => {
      try {
        const { messageId, senderId } = data;

        await Message.findByIdAndUpdate(messageId, {
          status: 'read',
          readAt: Date.now()
        });

        const senderSocketId = onlineUsers.get(senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message:status', {
            messageId,
            status: 'read'
          });
        }
      } catch (error) {
        console.error('Error updating message status:', error);
      }
    });

    // Handle marking all messages from a sender as read
    socket.on('messages:read', async (data) => {
      try {
        const { senderId } = data;

        // Update all unread messages from this sender
        const result = await Message.updateMany(
          { 
            sender: senderId, 
            receiver: socket.userId,
            status: { $ne: 'read' }
          },
          { 
            status: 'read',
            readAt: Date.now()
          }
        );

        // Notify sender about read status
        const senderSocketId = onlineUsers.get(senderId);
        if (senderSocketId && result.modifiedCount > 0) {
          io.to(senderSocketId).emit('messages:read', {
            receiverId: socket.userId,
            count: result.modifiedCount
          });
        }
      } catch (error) {
        console.error('Error updating messages status:', error);
      }
    });

    // Handle user disconnect
    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.userEmail}`);
      
      // Remove from online users
      onlineUsers.delete(socket.userId);

      // Update user status to offline
      User.findByIdAndUpdate(socket.userId, {
        status: 'offline',
        lastSeen: Date.now()
      }).exec();

      // Broadcast user offline status
      socket.broadcast.emit('user:offline', {
        userId: socket.userId,
        lastSeen: Date.now()
      });
    });
  });

  // Helper function to get online users
  io.getOnlineUsers = () => Array.from(onlineUsers.keys());
};
