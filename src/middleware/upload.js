const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Use local storage or Cloudinary based on environment
const USE_LOCAL_STORAGE = !process.env.CLOUDINARY_API_KEY || process.env.USE_LOCAL_STORAGE === 'true';

console.log('📁 Storage mode:', USE_LOCAL_STORAGE ? 'LOCAL' : 'CLOUDINARY');

// Cloudinary setup (for production)
let cloudinary;
if (!USE_LOCAL_STORAGE) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('☁️ Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME);
}

// Configure multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
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
    fileSize: 50 * 1024 * 1024
  }
});

// Helper function to save file locally or to Cloudinary
const saveFile = async (buffer, folder, filename) => {
  if (USE_LOCAL_STORAGE) {
    const uploadDir = path.join(__dirname, '../../uploads', folder);
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, buffer);
    
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/uploads/${folder}/${filename}`;
  } else {
    // Upload to Cloudinary
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `chatmail/${folder}`,
          public_id: filename.replace(/\.[^/.]+$/, ''),
          resource_type: 'auto'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result.secure_url);
        }
      );
      uploadStream.end(buffer);
    });
  }
};

const processAndUploadImage = async (req, res, next) => {
  try {
    console.log('📤 Upload request received');
    console.log('File details:', {
      originalname: req.file?.originalname,
      mimetype: req.file?.mimetype,
      size: req.file?.size
    });

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');
    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}${path.extname(req.file.originalname)}`;

    console.log(`File type: ${isImage ? 'Image' : isVideo ? 'Video' : 'Document'}`);

    if (isImage) {
      try {
        console.log('🖼️ Processing image with Sharp...');
        
        const compressedBuffer = await sharp(req.file.buffer)
          .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        console.log('✅ Image compressed');

        const thumbnailBuffer = await sharp(req.file.buffer)
          .resize(300, 300, { fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();

        console.log('✅ Thumbnail created');
        console.log('💾 Saving files...');
        
        const thumbnailFilename = `thumb_${uniqueFilename}`;
        
        const [imageUrl, thumbnailUrl] = await Promise.all([
          saveFile(compressedBuffer, 'images', uniqueFilename),
          saveFile(thumbnailBuffer, 'thumbnails', thumbnailFilename)
        ]);

        console.log('✅ Upload successful:', imageUrl);

        const imageMetadata = await sharp(compressedBuffer).metadata();

        req.uploadedImage = {
          url: imageUrl,
          publicId: uniqueFilename,
          thumbnail: thumbnailUrl,
          thumbnailPublicId: thumbnailFilename,
          width: imageMetadata.width,
          height: imageMetadata.height,
          size: compressedBuffer.length,
          format: imageMetadata.format,
          type: 'image'
        };

        console.log('✅ Image processed successfully');
      } catch (sharpError) {
        console.error('⚠️ Sharp processing failed:', sharpError.message);
        const imageUrl = await saveFile(req.file.buffer, 'images', uniqueFilename);
        
        req.uploadedImage = {
          url: imageUrl,
          publicId: uniqueFilename,
          thumbnail: imageUrl,
          thumbnailPublicId: uniqueFilename,
          width: null,
          height: null,
          size: req.file.size,
          format: path.extname(req.file.originalname).slice(1),
          type: 'image'
        };
      }
    } else {
      console.log('📁 Saving file...');
      const folder = isVideo ? 'videos' : 'documents';
      const fileUrl = await saveFile(req.file.buffer, folder, uniqueFilename);

      console.log('✅ Upload successful:', fileUrl);

      req.uploadedImage = {
        url: fileUrl,
        publicId: uniqueFilename,
        thumbnail: null,
        thumbnailPublicId: null,
        width: null,
        height: null,
        size: req.file.size,
        format: path.extname(req.file.originalname).slice(1),
        type: isVideo ? 'video' : 'document',
        fileName: req.file.originalname
      };

      console.log('✅ File processed successfully');
    }

    next();
  } catch (error) {
    console.error('❌ Error processing file:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

const deleteFile = async (publicId) => {
  try {
    if (USE_LOCAL_STORAGE) {
      const folders = ['images', 'videos', 'documents', 'thumbnails'];
      for (const folder of folders) {
        const filePath = path.join(__dirname, '../../uploads', folder, publicId);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } else if (cloudinary) {
      await cloudinary.uploader.destroy(publicId);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

module.exports = {
  upload,
  processAndUploadImage,
  deleteFromCloudinary: deleteFile
};
