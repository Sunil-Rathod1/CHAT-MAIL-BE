const Group = require('../models/Group');
const Message = require('../models/Message');
const User = require('../models/User');

// Create a new group
exports.createGroup = async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Group name is required'
      });
    }

    // Create group with creator as admin
    const group = await Group.create({
      name,
      description: description || '',
      createdBy: req.user._id,
      members: [
        {
          userId: req.user._id,
          role: 'admin',
          joinedAt: Date.now(),
          addedBy: req.user._id
        }
      ]
    });

    // Add other members if provided
    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      for (const memberId of memberIds) {
        if (memberId !== req.user._id.toString()) {
          group.members.push({
            userId: memberId,
            role: 'member',
            joinedAt: Date.now(),
            addedBy: req.user._id
          });
        }
      }
      await group.save();
    }

    await group.populate('members.userId', 'name email avatar');
    await group.populate('createdBy', 'name email avatar');

    res.status(201).json({
      success: true,
      data: group
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get user's groups
exports.getUserGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      'members.userId': req.user._id,
      isActive: true
    })
    .populate('members.userId', 'name email avatar')
    .populate('createdBy', 'name email avatar')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });

    res.json({
      success: true,
      data: groups
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get group details
exports.getGroupById = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.userId', 'name email avatar status')
      .populate('createdBy', 'name email avatar');

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if user is a member
    if (!group.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    res.json({
      success: true,
      data: group
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Add members to group
exports.addMembers = async (req, res) => {
  try {
    const { memberIds } = req.body;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check permissions
    if (group.settings.onlyAdminsCanAddMembers && !group.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can add members'
      });
    }

    // Check if user is a member
    if (!group.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    // Add members
    for (const memberId of memberIds) {
      // Check if already a member
      if (!group.isMember(memberId)) {
        // Check max members limit
        if (group.members.length >= group.settings.maxMembers) {
          return res.status(400).json({
            success: false,
            message: `Group has reached maximum members limit (${group.settings.maxMembers})`
          });
        }

        group.members.push({
          userId: memberId,
          role: 'member',
          joinedAt: Date.now(),
          addedBy: req.user._id
        });
      }
    }

    await group.save();
    await group.populate('members.userId', 'name email avatar');

    res.json({
      success: true,
      data: group
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Remove member from group
exports.removeMember = async (req, res) => {
  try {
    const { memberId } = req.params;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if user is admin or removing themselves
    if (!group.isAdmin(req.user._id) && memberId !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can remove other members'
      });
    }

    // Cannot remove the creator
    if (memberId === group.createdBy.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove group creator'
      });
    }

    group.members = group.members.filter(m => m.userId.toString() !== memberId);
    await group.save();

    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Update group settings
exports.updateGroup = async (req, res) => {
  try {
    const { name, description, avatar, settings } = req.body;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if user is admin
    if (group.settings.onlyAdminsCanEditGroupInfo && !group.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can edit group info'
      });
    }

    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (avatar) group.avatar = avatar;
    if (settings) {
      group.settings = { ...group.settings, ...settings };
    }

    await group.save();
    await group.populate('members.userId', 'name email avatar');

    res.json({
      success: true,
      data: group
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get group messages
exports.getGroupMessages = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if user is a member
    if (!group.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const messages = await Message.find({
      groupId: req.params.id,
      conversationType: 'group'
    })
    .populate('sender', 'name email avatar')
    .populate('replyTo.sender', 'name email avatar')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const totalMessages = await Message.countDocuments({
      groupId: req.params.id,
      conversationType: 'group'
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
