import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject,
  uploadString,
  UploadMetadata,
  StorageReference
} from 'firebase/storage';
import { storage, firebaseLogger } from './config';

/**
 * Create a safe ID from a string by removing special characters and replacing spaces with hyphens
 * @param input Input string
 * @returns Safe ID string
 */
const createSafeId = (input: string): string => {
  // Remove special characters and replace spaces with hyphens
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

/**
 * Upload a file to Firebase Storage
 * @param file File to upload
 * @param path Storage path
 * @param metadata Optional metadata
 * @returns Download URL of the uploaded file
 */
export const uploadFile = async (
  file: File | Blob | Uint8Array | ArrayBuffer,
  path: string,
  metadata?: UploadMetadata
): Promise<string> => {
  try {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file, metadata);
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    firebaseLogger.info(`File uploaded successfully to ${path}`);
    return downloadURL;
  } catch (error) {
    firebaseLogger.error('Error uploading file:', error);
    throw error;
  }
};

/**
 * Upload a data URL to Firebase Storage
 * @param dataUrl Data URL string
 * @param path Storage path
 * @param metadata Optional metadata
 * @returns Download URL of the uploaded file
 */
export const uploadDataUrl = async (
  dataUrl: string,
  path: string,
  metadata?: UploadMetadata
): Promise<string> => {
  try {
    const storageRef = ref(storage, path);
    const snapshot = await uploadString(storageRef, dataUrl, 'data_url', metadata);
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    firebaseLogger.info(`Data URL uploaded successfully to ${path}`);
    return downloadURL;
  } catch (error) {
    firebaseLogger.error('Error uploading data URL:', error);
    throw error;
  }
};

/**
 * Delete a file from Firebase Storage
 * @param path Storage path
 */
export const deleteFile = async (path: string): Promise<void> => {
  try {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
    
    firebaseLogger.info(`File deleted successfully from ${path}`);
  } catch (error) {
    firebaseLogger.error('Error deleting file:', error);
    throw error;
  }
};

/**
 * Get a download URL for a file in Firebase Storage
 * @param path Storage path
 * @returns Download URL
 */
export const getFileUrl = async (path: string): Promise<string> => {
  try {
    const storageRef = ref(storage, path);
    const downloadURL = await getDownloadURL(storageRef);
    
    return downloadURL;
  } catch (error) {
    firebaseLogger.error('Error getting file URL:', error);
    throw error;
  }
};

/**
 * Generate a unique path for a user's background image
 * @param userId User ID
 * @param fileExtension File extension (e.g., 'jpg', 'png')
 * @returns Storage path
 */
export const generateBackgroundImagePath = (userId: string, fileExtension: string): string => {
  const timestamp = Date.now();
  const uniqueId = createSafeId(`${userId}-${timestamp}`);
  return `users/${userId}/backgrounds/${uniqueId}.${fileExtension}`;
};

/**
 * Generate a unique path for a user's profile image
 * @param userId User ID
 * @param fileExtension File extension (e.g., 'jpg', 'png')
 * @returns Storage path
 */
export const generateProfileImagePath = (userId: string, fileExtension: string): string => {
  const timestamp = Date.now();
  const uniqueId = createSafeId(`${userId}-${timestamp}`);
  return `users/${userId}/profile/${uniqueId}.${fileExtension}`;
};

/**
 * Upload a user's background image
 * @param userId User ID
 * @param file File to upload
 * @param fileExtension File extension (e.g., 'jpg', 'png')
 * @returns Download URL of the uploaded background image
 */
export const uploadBackgroundImage = async (
  userId: string,
  file: File | Blob | Uint8Array | ArrayBuffer,
  fileExtension: string
): Promise<string> => {
  try {
    const path = generateBackgroundImagePath(userId, fileExtension);
    const metadata: UploadMetadata = {
      contentType: `image/${fileExtension}`,
      customMetadata: {
        userId,
        type: 'background',
        timestamp: Date.now().toString()
      }
    };
    
    return await uploadFile(file, path, metadata);
  } catch (error) {
    firebaseLogger.error('Error uploading background image:', error);
    throw error;
  }
};

/**
 * Upload a user's profile image
 * @param userId User ID
 * @param file File to upload
 * @param fileExtension File extension (e.g., 'jpg', 'png')
 * @returns Download URL of the uploaded profile image
 */
export const uploadProfileImage = async (
  userId: string,
  file: File | Blob | Uint8Array | ArrayBuffer,
  fileExtension: string
): Promise<string> => {
  try {
    const path = generateProfileImagePath(userId, fileExtension);
    const metadata: UploadMetadata = {
      contentType: `image/${fileExtension}`,
      customMetadata: {
        userId,
        type: 'profile',
        timestamp: Date.now().toString()
      }
    };
    
    return await uploadFile(file, path, metadata);
  } catch (error) {
    firebaseLogger.error('Error uploading profile image:', error);
    throw error;
  }
};

/**
 * Get the file extension from a file name or MIME type
 * @param input File name or MIME type
 * @returns File extension without the dot
 */
export const getFileExtension = (input: string): string => {
  // If input is a MIME type (e.g., "image/jpeg")
  if (input.includes('/')) {
    const parts = input.split('/');
    return parts[parts.length - 1];
  }
  
  // If input is a filename
  const parts = input.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
};

/**
 * Upload a background image from a data URL
 * @param userId User ID
 * @param dataUrl Data URL string
 * @returns Download URL of the uploaded background image
 */
export const uploadBackgroundImageFromDataUrl = async (
  userId: string,
  dataUrl: string
): Promise<string> => {
  try {
    // Extract file extension from data URL
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
    const fileExtension = matches ? matches[1] : 'png';
    
    const path = generateBackgroundImagePath(userId, fileExtension);
    const metadata: UploadMetadata = {
      contentType: `image/${fileExtension}`,
      customMetadata: {
        userId,
        type: 'background',
        timestamp: Date.now().toString()
      }
    };
    
    return await uploadDataUrl(dataUrl, path, metadata);
  } catch (error) {
    firebaseLogger.error('Error uploading background image from data URL:', error);
    throw error;
  }
};

/**
 * Upload a profile image from a data URL
 * @param userId User ID
 * @param dataUrl Data URL string
 * @returns Download URL of the uploaded profile image
 */
export const uploadProfileImageFromDataUrl = async (
  userId: string,
  dataUrl: string
): Promise<string> => {
  try {
    // Extract file extension from data URL
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
    const fileExtension = matches ? matches[1] : 'png';
    
    const path = generateProfileImagePath(userId, fileExtension);
    const metadata: UploadMetadata = {
      contentType: `image/${fileExtension}`,
      customMetadata: {
        userId,
        type: 'profile',
        timestamp: Date.now().toString()
      }
    };
    
    return await uploadDataUrl(dataUrl, path, metadata);
  } catch (error) {
    firebaseLogger.error('Error uploading profile image from data URL:', error);
    throw error;
  }
};
