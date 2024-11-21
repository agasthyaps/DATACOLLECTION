// server/src/index.ts
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { auth } from 'express-oauth2-jwt-bearer';
import { generateUploadUrl, generateTranscriptUploadUrl, generateTranscriptReadUrl } from './s3';
import dotenv from 'dotenv';
import path from 'path';
import { db, dbAsync } from './db';
import { startTranscription } from './transcription';
import { dot } from 'node:test/reporters';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";


dotenv.config();

// const result = dotenv.config();

// console.log('Dotenv loaded from:', path.resolve(process.cwd(), '.env'));
// console.log('Dotenv config result:', result);
// console.log('Environment variables status:', {
//   PORT: process.env.PORT ? 'present' : 'missing',
//   AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE ? 'present' : 'missing',
//   AUTH0_ISSUER: process.env.AUTH0_ISSUER ? 'present' : 'missing',
//   AWS_REGION: process.env.AWS_REGION ? 'present' : 'missing',
//   AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'present' : 'missing',
//   AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? 'present' : 'missing',
//   S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ? 'present' : 'missing',
//   ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY ? 'present' : 'missing'
// });

// // Add this to test direct access to AWS credentials
// console.log('Direct AWS credential test:', {
//   hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
//   accessKeyLength: process.env.AWS_ACCESS_KEY_ID?.length || 0,
//   hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
//   secretKeyLength: process.env.AWS_SECRET_ACCESS_KEY?.length || 0
// });

// Validate required environment variables
const requiredEnvVars = [
  'AUTH0_AUDIENCE',
  'AUTH0_ISSUER',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET_NAME',
  'ASSEMBLYAI_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();

const allowedOrigins = [
  'https://tl-datacollection.vercel.app',  // Production frontend
  'http://localhost:5173',                 // Development frontend
];

const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin); // This will help us debug
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// Auth0 middleware configuration
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER,
  tokenSigningAlg: 'RS256'
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Auth error:', error);
  if (error.name === 'InvalidTokenError') {
    console.log('Token validation failed:', {
      error: error.message,
      token: req.headers.authorization?.substring(0, 20) + '...',
      audience: process.env.AUTH0_AUDIENCE,
      issuer: process.env.AUTH0_ISSUER
    });
    return res.status(401).json({ 
      error: 'Invalid token',
      details: error.message
    });
  }
  next(error);
});

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  if (req.body) console.log('Body:', req.body);
  next();
});

// Test endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Protected test endpoint
app.get('/api/protected', checkJwt, (req: Request, res: Response) => {
  res.json({ message: 'This is a protected endpoint' });
});

app.get('/api/ping', (req: Request, res: Response) => {
  res.json({ message: 'pong' });
});

app.get('/api/protected-ping', checkJwt, (req: Request, res: Response) => {
  res.json({ 
    message: 'protected pong',
    user: req.auth
  });
});

app.get('/api/debug-auth', checkJwt, (req: Request, res: Response) => {
  console.log('Auth debug endpoint hit');
  console.log('Auth payload:', req.auth);
  res.json({ 
    message: 'Auth successful',
    token: {
      sub: req.auth?.payload.sub,
      aud: req.auth?.payload.aud,
      iss: req.auth?.payload.iss,
    }
  });
});

// Generate presigned URL for S3 upload
app.post('/api/recordings/upload-url', checkJwt, async (req: Request, res: Response) => {
  try {
    console.log('Upload URL request received');
    console.log('Auth payload:', req.auth);
    
    const { participantId } = req.body;
    const userId = req.auth?.payload.sub;

    console.log('Processing upload URL request:', {
      userId,
      participantId,
      hasAuth: !!req.auth
    });

    if (!userId || !participantId) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: {
          hasUserId: !!userId,
          hasParticipantId: !!participantId
        }
      });
    }

    try {
      const { uploadUrl, objectKey } = await generateUploadUrl(userId, participantId);
      console.log('Generated upload URL successfully:', {
        objectKey,
        urlLength: uploadUrl.length
      });

      const result = await dbAsync.run(
        `INSERT INTO recordings (user_id, participant_id, s3_url, status)
         VALUES (?, ?, ?, ?)`,
        [userId, participantId, objectKey, 'pending']
      );

      const response = {
        uploadUrl,
        recordingId: result?.lastID,
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error generating upload URL:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in upload URL endpoint:', error);
    if (error instanceof Error) {
      res.status(500).json({ 
        error: 'Error in upload URL endpoint',
        details: error.message
      });
    } else {
      res.status(500).json({ 
        error: 'Error in upload URL endpoint',
        details: 'An unknown error occurred'
      });
    }
  }
});

// Update recording status after successful upload
app.post('/api/recordings/:id/complete', checkJwt, async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth?.payload.sub;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const recording = await dbAsync.get(
      `SELECT s3_url FROM recordings WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    await dbAsync.run(
      `UPDATE recordings SET status = 'uploaded' WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    await startTranscription(parseInt(id), recording.s3_url, userId);
    
    res.json({ 
      success: true,
      message: 'Upload completed and transcription started'
    });
  } catch (error) {
    console.error('Error in recording completion:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    res.status(500).json({ 
      error: 'Failed to process recording',
      details: errorMessage
    });
  }
});

const startServer = async (initialPort: number) => {
  const findAvailablePort = async (startPort: number): Promise<number> => {
    return new Promise((resolve) => {
      const server = app.listen(startPort, () => {
        server.close(() => {
          resolve(startPort);
        });
      }).on('error', () => {
        resolve(findAvailablePort(startPort + 1));
      });
    });
  };

  try {
    const port = await findAvailablePort(initialPort);
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log('Registered Routes:');
      app._router.stack.forEach((middleware: any) => {
        if (middleware.route) {
          console.log(`${Object.keys(middleware.route.methods)} ${middleware.route.path}`);
        } else if (middleware.name === 'router') {
          middleware.handle.stack.forEach((handler: any) => {
            if (handler.route) {
              console.log(`${Object.keys(handler.route.methods)} ${handler.route.path}`);
            }
          });
        }
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Initialize the server
startServer(Number(process.env.PORT) || 3000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err: Error | null) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

// Middleware to check if user is admin
async function isAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    // Get the user's sub from the token
    const userSub = req.auth?.payload.sub;
    console.log('User sub from token:', userSub);

    if (!userSub) {
      return res.status(401).json({ error: 'No user identifier found' });
    }

    // Get user info from Auth0 management API
    const response = await fetch(`${process.env.AUTH0_ISSUER}userinfo`, {
      headers: {
        'Authorization': req.headers.authorization || ''
      }
    });

    if (!response.ok) {
      console.error('Failed to get user info:', response.status);
      return res.status(401).json({ error: 'Failed to get user info' });
    }

    const userInfo = await response.json();
    console.log('User info:', userInfo);

    // Now check if this email is in admin_team
    const admin = await dbAsync.get(
      'SELECT COUNT(*) as count FROM admin_team WHERE email = ?',
      [userInfo.email]
    );

    console.log('Admin check result:', admin);

    if (!admin || admin.count === 0) {
      return res.status(403).json({ error: 'Not an admin' });
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

// Get all recordings with related data
app.get('/api/admin/recordings', checkJwt, isAdmin, async (req: Request, res: Response) => {
  try {
    const recordings = await dbAsync.all(`
      SELECT 
        r.id,
        r.recorded_at,
        r.status as recording_status,
        r.s3_url,
        r.user_id,          -- This is the auth0_id
        p.identifier as participant_identifier,
        t.status as transcript_status,
        t.preview_text,
        t.s3_url as transcript_url,
        t.confidence,
        t.error_message
      FROM recordings r
      LEFT JOIN participants p ON r.participant_id = p.id
      LEFT JOIN transcripts t ON r.id = t.recording_id
      ORDER BY r.recorded_at DESC
    `);

    // Map the data for the frontend
    const formattedRecordings = recordings.map(r => ({
      ...r,
      researcher_email: r.user_id // For now, just show the auth0_id
      // Later we can add a users table lookup if needed
    }));

    console.log('Fetched recordings:', formattedRecordings);
    res.json({ recordings: formattedRecordings });
  } catch (error) {
    console.error('Error fetching recordings:', error);
    res.status(500).json({ 
      error: 'Error fetching recordings',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Retry transcription
app.post('/api/admin/transcripts/:id/retry', checkJwt, isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const recording = await dbAsync.get(
      'SELECT * FROM recordings WHERE id = ?',
      [id]
    );

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Reset transcript status
    await dbAsync.run(
      `UPDATE transcripts 
       SET status = 'pending', error_message = NULL 
       WHERE recording_id = ?`,
      [id]
    );

    // Start new transcription
    await startTranscription(
      parseInt(id),
      recording.s3_url,
      recording.user_id
    );

    res.json({ message: 'Transcription retry initiated' });
  } catch (error) {
    console.error('Error retrying transcription:', error);
    res.status(500).json({ error: 'Error retrying transcription' });
  }
});

// Update transcript
app.put('/api/admin/transcripts/:id', checkJwt, isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { text, metadata } = req.body;

    const recording = await dbAsync.get(
      'SELECT * FROM recordings WHERE id = ?',
      [id]
    );

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Generate new S3 upload URL
    const { uploadUrl } = await generateTranscriptUploadUrl(
      recording.user_id,
      recording.participant_id.toString(),
      id
    );

    // Upload updated transcript to S3
    await fetch(uploadUrl, {
      method: 'PUT',
      body: JSON.stringify({
        text,
        metadata,
        recordingId: id,
        timestamp: new Date().toISOString(),
        editedByAdmin: true
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Update preview in database
    const previewText = text.slice(0, 500) + (text.length > 500 ? '...' : '');
    await dbAsync.run(
      `UPDATE transcripts 
       SET preview_text = ?,
           status = 'completed',
           created_at = CURRENT_TIMESTAMP
       WHERE recording_id = ?`,
      [previewText, id]
    );

    res.json({ message: 'Transcript updated' });
  } catch (error) {
    console.error('Error updating transcript:', error);
    res.status(500).json({ error: 'Error updating transcript' });
  }
});

// Admin team management
app.get('/api/admin/team', checkJwt, isAdmin, (req: Request, res: Response) => {
  // If we got here, user is an admin
  res.json({ isAdmin: true });
});

app.post('/api/admin/team', checkJwt, isAdmin, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    await dbAsync.run('INSERT INTO admin_team (email) VALUES (?)', [email]);
    res.json({ message: 'Admin added successfully' });
  } catch (error) {
    console.error('Error adding admin:', error);
    res.status(500).json({ error: 'Error adding admin' });
  }
});

app.get('/api/admin/transcripts/:id/read-url', checkJwt, isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get the transcript record to find the S3 URL
    const transcript = await dbAsync.get(
      `SELECT t.s3_url, r.user_id 
       FROM transcripts t
       JOIN recordings r ON t.recording_id = r.id
       WHERE r.id = ?`,
      [id]
    );

    if (!transcript?.s3_url) {
      return res.status(404).json({ error: 'Transcript not found or no S3 URL available' });
    }

    const readUrl = await generateTranscriptReadUrl(transcript.s3_url);
    
    res.json({ readUrl });
  } catch (error) {
    console.error('Error generating read URL:', error);
    res.status(500).json({ error: 'Failed to generate read URL' });
  }
});

app.get('/api/admin/recordings/:id/audio-url', checkJwt, isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Get recording details from database
    const recording = await dbAsync.get(
      'SELECT s3_url FROM recordings WHERE id = ?',
      [id]
    );

    if (!recording?.s3_url) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Create S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }
    });

    // Generate presigned URL
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: recording.s3_url
    });

    const audioUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    
    res.json({ audioUrl });
  } catch (error) {
    console.error('Error generating audio URL:', error);
    res.status(500).json({ error: 'Failed to generate audio URL' });
  }
});

export default app;