const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');

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

    // Handle message reactions
    socket.on('message:react', async (data) => {
      try {
        const { messageId, emoji } = data;

        // Find the message
        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('reaction:error', { message: 'Message not found' });
          return;
        }

        // Check if user already reacted with this emoji
        const existingReaction = message.reactions.find(
          r => r.userId.toString() === socket.userId && r.emoji === emoji
        );

        if (existingReaction) {
          // Remove reaction (toggle off)
          message.reactions = message.reactions.filter(
            r => !(r.userId.toString() === socket.userId && r.emoji === emoji)
          );
        } else {
          // Remove any other reaction from this user (only one reaction per user)
          message.reactions = message.reactions.filter(
            r => r.userId.toString() !== socket.userId
          );
          // Add new reaction
          message.reactions.push({
            userId: socket.userId,
            emoji,
            createdAt: Date.now()
          });
        }

        await message.save();
        await message.populate('reactions.userId', 'name avatar');

        // Broadcast reaction update to both sender and receiver
        const senderId = message.sender.toString();
        const receiverId = message.receiver.toString();

        const reactionData = {
          messageId,
          reactions: message.reactions,
          updatedBy: socket.userId
        };

        // Send to sender
        const senderSocketId = onlineUsers.get(senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message:reaction', reactionData);
        }

        // Send to receiver
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:reaction', reactionData);
        }

      } catch (error) {
        console.error('Error handling reaction:', error);
        socket.emit('reaction:error', { message: error.message });
      }
    });

    // Handle message editing
    socket.on('message:edit', async (data) => {
      try {
        const { messageId, content } = data;

        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('message:error', { message: 'Message not found' });
          return;
        }

        // Check if user is the sender
        if (message.sender.toString() !== socket.userId) {
          socket.emit('message:error', { message: 'Unauthorized' });
          return;
        }

        // Check if message is within edit time limit (15 minutes)
        const fifteenMinutes = 15 * 60 * 1000;
        if (Date.now() - new Date(message.createdAt).getTime() > fifteenMinutes) {
          socket.emit('message:error', { message: 'Edit time limit exceeded (15 minutes)' });
          return;
        }

        // Save to edit history
        if (!message.editHistory) {
          message.editHistory = [];
        }
        message.editHistory.push({
          content: message.content,
          editedAt: Date.now()
        });

        // Update message
        message.content = content;
        message.isEdited = true;
        message.editedAt = Date.now();
        await message.save();

        await message.populate('sender', 'name email avatar');
        await message.populate('receiver', 'name email avatar');

        const editData = {
          messageId,
          content,
          isEdited: true,
          editedAt: message.editedAt
        };

        // Broadcast to both users
        const receiverId = message.receiver.toString();
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:edited', editData);
        }

        // Send to sender
        socket.emit('message:edited', editData);

      } catch (error) {
        console.error('Error editing message:', error);
        socket.emit('message:error', { message: error.message });
      }
    });

    // Handle message deletion
    socket.on('message:delete', async (data) => {
      try {
        const { messageId, deleteType } = data; // deleteType: 'me' or 'everyone'

        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('message:error', { message: 'Message not found' });
          return;
        }

        // Check if user is the sender
        if (message.sender.toString() !== socket.userId) {
          socket.emit('message:error', { message: 'Unauthorized' });
          return;
        }

        if (deleteType === 'everyone') {
          // Check if message is within delete time limit (1 hour)
          const oneHour = 60 * 60 * 1000;
          if (Date.now() - new Date(message.createdAt).getTime() > oneHour) {
            socket.emit('message:error', { message: 'Delete time limit exceeded (1 hour)' });
            return;
          }

          message.deletedForEveryone = true;
          message.isDeleted = true;
          message.deletedAt = Date.now();
          message.content = 'This message was deleted';
          await message.save();

          // Broadcast to receiver
          const receiverId = message.receiver.toString();
          const receiverSocketId = onlineUsers.get(receiverId);
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('message:deleted', {
              messageId,
              deleteType: 'everyone'
            });
          }

          // Send to sender
          socket.emit('message:deleted', {
            messageId,
            deleteType: 'everyone'
          });
        } else {
          // Delete for me only
          if (!message.deletedBy) {
            message.deletedBy = [];
          }
          message.deletedBy.push({
            userId: socket.userId,
            deletedAt: Date.now()
          });
          await message.save();

          socket.emit('message:deleted', {
            messageId,
            deleteType: 'me'
          });
        }

      } catch (error) {
        console.error('Error deleting message:', error);
        socket.emit('message:error', { message: error.message });
      }
    });

    // ============= GROUP CHAT EVENTS =============

    // Send message to group
    socket.on('group:message:send', async (data) => {
      try {
        const { groupId, content, type = 'text', replyTo } = data;

        // Check if user is member of group
        const group = await Group.findById(groupId);
        if (!group) {
          return socket.emit('message:error', { message: 'Group not found' });
        }

        if (!group.isMember(socket.userId)) {
          return socket.emit('message:error', { message: 'You are not a member of this group' });
        }

        // Check if only admins can post
        if (group.settings.onlyAdminsCanPost && !group.isAdmin(socket.userId)) {
          return socket.emit('message:error', { message: 'Only admins can post in this group' });
        }

        // Create group message
        const message = await Message.create({
          sender: socket.userId,
          content,
          type,
          conversationType: 'group',
          groupId,
          replyTo,
          readBy: [{ user: socket.userId, readAt: Date.now() }]
        });

        await message.populate('sender', 'name email avatar');
        if (replyTo?.messageId) {
          await message.populate('replyTo.sender', 'name email avatar');
        }

        // Update group's lastMessage
        group.lastMessage = message._id;
        await group.save();

        // Send to all online group members
        const onlineMembers = group.members
          .filter(m => onlineUsers.has(m.userId.toString()) && m.userId.toString() !== socket.userId)
          .map(m => onlineUsers.get(m.userId.toString()));

        onlineMembers.forEach(socketId => {
          io.to(socketId).emit('group:message:receive', message);
        });

        // Send confirmation to sender
        socket.emit('group:message:sent', message);

      } catch (error) {
        console.error('Error sending group message:', error);
        socket.emit('message:error', { message: error.message });
      }
    });

    // User joins a group (called when entering group chat)
    socket.on('group:join', async (data) => {
      try {
        const { groupId } = data;
        
        const group = await Group.findById(groupId);
        if (!group || !group.isMember(socket.userId)) {
          return socket.emit('message:error', { message: 'Cannot join group' });
        }

        // Join socket room for group
        socket.join(`group_${groupId}`);

        // Notify other members
        socket.to(`group_${groupId}`).emit('group:member-joined', {
          groupId,
          userId: socket.userId,
          timestamp: Date.now()
        });

      } catch (error) {
        console.error('Error joining group:', error);
      }
    });

    // User leaves a group (called when exiting group chat)
    socket.on('group:leave', async (data) => {
      try {
        const { groupId } = data;
        
        socket.leave(`group_${groupId}`);

        // Notify other members
        socket.to(`group_${groupId}`).emit('group:member-left', {
          groupId,
          userId: socket.userId,
          timestamp: Date.now()
        });

      } catch (error) {
        console.error('Error leaving group:', error);
      }
    });

    // New member added to group
    socket.on('group:member-add', async (data) => {
      try {
        const { groupId, memberIds } = data;

        const group = await Group.findById(groupId);
        if (!group) {
          return socket.emit('message:error', { message: 'Group not found' });
        }

        // Check permissions
        if (group.settings.onlyAdminsCanAddMembers && !group.isAdmin(socket.userId)) {
          return socket.emit('message:error', { message: 'Only admins can add members' });
        }

        // Notify all online group members including new ones
        io.to(`group_${groupId}`).emit('group:members-added', {
          groupId,
          memberIds,
          addedBy: socket.userId,
          timestamp: Date.now()
        });

        // Notify new members individually
        memberIds.forEach(memberId => {
          const memberSocketId = onlineUsers.get(memberId);
          if (memberSocketId) {
            io.to(memberSocketId).emit('group:added-to-group', {
              group: group.toObject()
            });
          }
        });

      } catch (error) {
        console.error('Error adding members:', error);
        socket.emit('message:error', { message: error.message });
      }
    });

    // Member removed from group
    socket.on('group:member-remove', async (data) => {
      try {
        const { groupId, memberId } = data;

        const group = await Group.findById(groupId);
        if (!group) {
          return socket.emit('message:error', { message: 'Group not found' });
        }

        // Check permissions (admins or self)
        if (!group.isAdmin(socket.userId) && socket.userId !== memberId) {
          return socket.emit('message:error', { message: 'Permission denied' });
        }

        // Notify all group members
        io.to(`group_${groupId}`).emit('group:member-removed', {
          groupId,
          memberId,
          removedBy: socket.userId,
          timestamp: Date.now()
        });

        // Notify removed member
        const memberSocketId = onlineUsers.get(memberId);
        if (memberSocketId) {
          io.to(memberSocketId).emit('group:removed-from-group', {
            groupId,
            removedBy: socket.userId
          });
          // Force leave the group room
          io.sockets.sockets.get(memberSocketId)?.leave(`group_${groupId}`);
        }

      } catch (error) {
        console.error('Error removing member:', error);
        socket.emit('message:error', { message: error.message });
      }
    });

    // Group info updated
    socket.on('group:update', async (data) => {
      try {
        const { groupId, updates } = data;

        const group = await Group.findById(groupId);
        if (!group) {
          return socket.emit('message:error', { message: 'Group not found' });
        }

        // Check permissions
        if (group.settings.onlyAdminsCanEditGroupInfo && !group.isAdmin(socket.userId)) {
          return socket.emit('message:error', { message: 'Only admins can edit group info' });
        }

        // Notify all group members
        io.to(`group_${groupId}`).emit('group:updated', {
          groupId,
          updates,
          updatedBy: socket.userId,
          timestamp: Date.now()
        });

      } catch (error) {
        console.error('Error updating group:', error);
        socket.emit('message:error', { message: error.message });
      }
    });

    // Mark group message as read
    socket.on('group:message:read', async (data) => {
      try {
        const { messageId, groupId } = data;

        const message = await Message.findById(messageId);
        if (!message || message.conversationType !== 'group') {
          return;
        }

        // Add user to readBy array if not already there
        const alreadyRead = message.readBy.some(r => r.user.toString() === socket.userId);
        if (!alreadyRead) {
          message.readBy.push({ user: socket.userId, readAt: Date.now() });
          await message.save();
        }

        // Notify all group members
        io.to(`group_${groupId}`).emit('group:message:read-receipt', {
          messageId,
          userId: socket.userId,
          readAt: Date.now()
        });

      } catch (error) {
        console.error('Error marking group message as read:', error);
      }
    });

    // Group typing indicator
    socket.on('group:typing:start', (data) => {
      const { groupId } = data;
      socket.to(`group_${groupId}`).emit('group:typing:user', {
        groupId,
        userId: socket.userId,
        isTyping: true
      });
    });

    socket.on('group:typing:stop', (data) => {
      const { groupId } = data;
      socket.to(`group_${groupId}`).emit('group:typing:user', {
        groupId,
        userId: socket.userId,
        isTyping: false
      });
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
