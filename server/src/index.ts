// server/src/index.ts
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { auth } from 'express-oauth2-jwt-bearer';
import { generateUploadUrl } from './s3';
import dotenv from 'dotenv';
import path from 'path';
import { db, dbAsync } from './db';
import { startTranscription } from './transcription';
import { dot } from 'node:test/reporters';

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

export default app;