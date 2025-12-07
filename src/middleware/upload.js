const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
const imagesDir = path.join(uploadsDir, 'images');
const videosDir = path.join(uploadsDir, 'videos');
const documentsDir = path.join(uploadsDir, 'documents');
const thumbnailsDir = path.join(uploadsDir, 'thumbnails');

[uploadsDir, imagesDir, videosDir, documentsDir, thumbnailsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = uploadsDir;
    
    if (file.mimetype.startsWith('image/')) {
      uploadPath = imagesDir;
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath = videosDir;
    } else {
      uploadPath = documentsDir;
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images, videos, and documents
  const allowedTypes = [
    'image/',
    'video/',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ];

  const isAllowed = allowedTypes.some(type => file.mimetype.startsWith(type) || file.mimetype === type);
  
  if (isAllowed) {
    cb(null, true);
  } else {
    cb(new Error('File type not supported'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size for videos
  }
});

// Middleware to process and upload files locally
const processAndUploadImage = async (req, res, next) => {
  try {
    console.log('📤 Upload request received');
    console.log('File details:', {
      originalname: req.file?.originalname,
      mimetype: req.file?.mimetype,
      size: req.file?.size,
      path: req.file?.path
    });

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    
    // Get relative path from uploads directory
    const relativePath = path.relative(uploadsDir, req.file.path);
    const fileUrl = `${baseUrl}/uploads/${relativePath.replace(/\\/g, '/')}`;

    console.log(`File type: ${isImage ? 'Image' : isVideo ? 'Video' : 'Document'}`);

    // For images: create thumbnail
    if (isImage) {
      try {
        console.log('🖼️ Creating thumbnail with Sharp...');
        
        const thumbnailName = `thumb_${req.file.filename}`;
        const thumbnailPath = path.join(thumbnailsDir, thumbnailName);
        
        // Generate thumbnail
        const metadata = await sharp(req.file.path)
          .resize(300, 300, { 
            fit: 'cover' 
          })
          .jpeg({ quality: 70 })
          .toFile(thumbnailPath);

        console.log('✅ Thumbnail created');

        const imageMetadata = await sharp(req.file.path).metadata();
        const thumbnailUrl = `${baseUrl}/uploads/thumbnails/${thumbnailName}`;

        req.uploadedImage = {
          url: fileUrl,
          publicId: req.file.filename,
          thumbnail: thumbnailUrl,
          thumbnailPublicId: thumbnailName,
          width: imageMetadata.width,
          height: imageMetadata.height,
          size: req.file.size,
          format: imageMetadata.format,
          type: 'image'
        };

        console.log('✅ Image processed successfully');
      } catch (sharpError) {
        console.error('⚠️ Sharp processing failed:', sharpError.message);
        // If Sharp fails, use original as thumbnail
        req.uploadedImage = {
          url: fileUrl,
          publicId: req.file.filename,
          thumbnail: fileUrl,
          thumbnailPublicId: req.file.filename,
          width: null,
          height: null,
          size: req.file.size,
          format: path.extname(req.file.filename).slice(1),
          type: 'image'
        };
      }
    } 
    // For videos and documents: no processing needed
    else {
      console.log('📁 File saved successfully');

      req.uploadedImage = {
        url: fileUrl,
        publicId: req.file.filename,
        thumbnail: null,
        thumbnailPublicId: null,
        width: null,
        height: null,
        size: req.file.size,
        format: path.extname(req.file.filename).slice(1),
        type: isVideo ? 'video' : 'document',
        fileName: req.file.originalname
      };

      console.log('✅ File processed successfully');
    }

    next();
  } catch (error) {
    console.error('❌ Error processing file:', error.message);
    console.error('Error stack:', error.stack);
    
    // Send detailed error to client in development
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Delete image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
  }
};

module.exports = {
  upload,
  processAndUploadImage,
  deleteFromCloudinary
};
