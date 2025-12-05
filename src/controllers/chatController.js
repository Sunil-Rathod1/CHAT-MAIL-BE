const Message = require('../models/Message');
const User = require('../models/User');

// Send a message (via HTTP - backup)
exports.sendMessage = async (req, res) => {
  try {
    const { receiverId, content, type, replyTo } = req.body;

    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    const message = await Message.create({
      sender: req.user._id,
      receiver: receiverId,
      content,
      type: type || 'text',
      conversationType: 'direct',
      replyTo
    });

    await message.populate('sender', 'name email avatar');
    await message.populate('receiver', 'name email avatar');
    if (replyTo?.messageId) {
      await message.populate('replyTo.sender', 'name email avatar');
    }

    res.status(201).json({
      success: true,
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get chat history between two users
exports.getChatHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, receiver: userId, conversationType: 'direct' },
        { sender: userId, receiver: req.user._id, conversationType: 'direct' }
      ],
      'deletedBy.userId': { $ne: req.user._id }
    })
      .populate('sender', 'name email avatar')
      .populate('receiver', 'name email avatar')
      .populate('replyTo.sender', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalMessages = await Message.countDocuments({
      $or: [
        { sender: req.user._id, receiver: userId, conversationType: 'direct' },
        { sender: userId, receiver: req.user._id, conversationType: 'direct' }
      ],
      'deletedBy.userId': { $ne: req.user._id }
    });

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          total: totalMessages,
          page: parseInt(page),
          pages: Math.ceil(totalMessages / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get recent conversations
exports.getConversations = async (req, res) => {
  try {
    console.log('Getting conversations for user:', req.user._id);

    // First, find all unique users the current user has chatted with
    const messages = await Message.find({
      $or: [
        { sender: req.user._id, conversationType: 'direct' },
        { receiver: req.user._id, conversationType: 'direct' }
      ],
      'deletedBy.userId': { $ne: req.user._id }
    })
      .sort({ createdAt: -1 })
      .populate('sender', 'name email avatar status')
      .populate('receiver', 'name email avatar status')
      .populate('replyTo.sender', 'name email avatar')
      .limit(100);

    console.log('Found messages:', messages.length);

    // Group by conversation partner
    const conversationMap = new Map();

    messages.forEach(message => {
      // Determine the other user (conversation partner)
      const otherUserId = message.sender._id.toString() === req.user._id.toString()
        ? message.receiver._id.toString()
        : message.sender._id.toString();

      // Only keep the most recent message per conversation
      if (!conversationMap.has(otherUserId)) {
        conversationMap.set(otherUserId, {
          _id: otherUserId,
          lastMessage: message
        });
      }
    });

    // Convert map to array
    const conversations = Array.from(conversationMap.values());

    console.log('Processed conversations:', conversations.length);

    res.json({
      success: true,
      data: conversations
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
  try {
    const { senderId } = req.body;

    await Message.updateMany(
      {
        sender: senderId,
        receiver: req.user._id,
        status: { $ne: 'read' }
      },
      {
        status: 'read',
        readAt: Date.now()
      }
    );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Upload image
exports.uploadImage = async (req, res) => {
  try {
    // Image processing is done by middleware
    // req.uploadedImage contains the URLs and metadata

    if (!req.uploadedImage) {
      return res.status(400).json({
        success: false,
        message: 'Image upload failed'
      });
    }

    res.json({
      success: true,
      data: req.uploadedImage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
