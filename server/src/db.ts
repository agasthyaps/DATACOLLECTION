// server/src/db.ts
import sqlite3 from 'sqlite3';

interface ColumnInfo {
    count: number;
  }

// Add production database path
const dbPath = process.env.NODE_ENV === 'production' 
  ? '/data/recordings.db'  // Persistent storage path on Railway/Render
  : './recordings.db';


// Create a new database instance
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    createTables();
  }
});

// Promisified database operations
export const dbAsync = {
  run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  },

  get<T = any>(sql: string, params: any[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  },

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }
};

// Create tables and run migrations
function createTables() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        auth0_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Participants table
    db.run(`
      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        name TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(auth0_id)
      )
    `);

    // Recordings table
    db.run(`
      CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        participant_id INTEGER NOT NULL,
        s3_url TEXT,
        duration INTEGER,
        file_size INTEGER,
        status TEXT DEFAULT 'pending',
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(auth0_id),
        FOREIGN KEY (participant_id) REFERENCES participants(id)
      )
    `);

    // Updated transcripts table - base schema
    db.run(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recording_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          metadata JSON,
          status TEXT DEFAULT 'pending',
          confidence REAL,
          speaker_count INTEGER,
          FOREIGN KEY (recording_id) REFERENCES recordings(id)
        )
      `);
  
      // Fixed column additions
      const addColumnIfNotExists = (columnName: string, columnDef: string) => {
        db.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM pragma_table_info('transcripts') WHERE name = ?`,
          [columnName],
          (err, row) => {
            if (err) {
              console.error(`Error checking for column ${columnName}:`, err);
              return;
            }
            
            if (row && row.count === 0) {
              // Fix: Properly escape column definition
              db.run(`ALTER TABLE transcripts ADD COLUMN "${columnName}" ${columnDef}`, (err) => {
                if (err) {
                  console.error(`Error adding column ${columnName}:`, err);
                } else {
                  console.log(`Successfully added column: ${columnName}`);
                }
              });
            } else {
              console.log(`Column already exists: ${columnName}`);
            }
          }
        );
      };

       // Admin team table - simple list of admin emails
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_team (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
  
      // Add a default admin if table is empty
      db.get(
        'SELECT COUNT(*) as count FROM admin_team',
        [],
        (err, row: { count: number }) => {
          if (err) {
            console.error('Error checking admin_team:', err);
            return;
          }
          
          if (row.count === 0 && process.env.INITIAL_ADMIN_EMAIL) {
            db.run(
              'INSERT INTO admin_team (email) VALUES (?)',
              [process.env.INITIAL_ADMIN_EMAIL],
              (err) => {
                if (err) {
                  console.error('Error adding initial admin:', err);
                } else {
                  console.log('Added initial admin:', process.env.INITIAL_ADMIN_EMAIL);
                }
              }
            );
          }
        }
      );
  
      // Add new columns with correct syntax
      addColumnIfNotExists('s3_url', 'TEXT');
      addColumnIfNotExists('preview_text', 'TEXT');  // Fixed: removed 'TEXT' from name
      addColumnIfNotExists('error_message', 'TEXT');  // Fixed: removed 'TEXT' from name
      addColumnIfNotExists('retry_count', 'INTEGER DEFAULT 0');
      
      // For last_updated, we'll use created_at for now
      // SQLite doesn't support CURRENT_TIMESTAMP as a default value in ALTER TABLE
      // We'll handle the timestamp updates in our application logic
      
      // Log final table schema
      db.all(
        `SELECT * FROM pragma_table_info('transcripts');`,
        [],
        (err, rows) => {
          if (err) {
            console.error('Error checking transcript table schema:', err);
          } else {
            console.log('Transcript table schema after migration:', rows);
          }
        }
      );
    });
  }
export { db, createTables };