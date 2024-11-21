// server/src/config.ts - Let's centralize our configuration
export const config = {
    port: process.env.PORT || 3000,
    dbPath: process.env.NODE_ENV === 'production' 
      ? '/data/recordings.db'
      : './recordings.db',
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL || 'https://datacollection-xi.vercel.app'
        : 'http://localhost:5173'
    }
  };