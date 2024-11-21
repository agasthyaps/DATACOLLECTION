// server/src/s3.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromIni } from "@aws-sdk/credential-providers";
import { randomUUID } from 'crypto';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: fromIni({ 
    profile: 'tl_coachrec'
  })
});

// Log safe configuration info
// console.log('S3 Client Configuration:', {
//   region: process.env.AWS_REGION,
//   bucket: process.env.S3_BUCKET_NAME,
//   profile: 'tl_coachrec'
// });

export async function generateUploadUrl(userId: string, participantId: string): Promise<{
  uploadUrl: string;
  objectKey: string;
}> {
  try {
    // Verify credentials
    const creds = await s3Client.config.credentials();
    console.log('Using credentials from profile:', {
      profile: 'tl_coachrec',
      keyPrefix: creds.accessKeyId.substring(0, 4)
    });

    const fileId = randomUUID();
    const objectKey = `recordings/${userId}/${participantId}/${fileId}.webm`;

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: objectKey,
      ContentType: 'audio/webm'
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300, // 5 minutes for upload
    });

    return {
      uploadUrl,
      objectKey
    };
  } catch (err) {
    const error = err as Error;
    console.error('Error generating upload URL:', {
      errorType: error.constructor.name,
      message: error.message
    });
    throw new Error(`Failed to generate upload URL: ${error.message}`);
  }
}

export async function generateReadUrl(objectKey: string): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: objectKey
    });

    const readUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600 // 1 hour for transcription
    });

    return readUrl;
  } catch (err) {
    const error = err as Error;
    console.error('Error generating read URL:', {
      errorType: error.constructor.name,
      message: error.message
    });
    throw new Error(`Failed to generate read URL: ${error.message}`);
  }
}