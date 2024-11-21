// server/src/db.ts
import sqlite3 from 'sqlite3';

interface ColumnInfo {
    count: number;
  }

// Create a new database instance
const db = new sqlite3.Database('recordings.db', (err) => {
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

    // Transcripts table with initial schema
    db.run(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recording_id) REFERENCES recordings(id)
      )
    `);

    // Safe migrations for transcripts table
    console.log('Running migrations for transcripts table...');
    
    // Add columns one at a time with proper error handling
    const addColumnIfNotExists = (columnName: string, columnDef: string) => {
      db.get<ColumnInfo>(
        `SELECT COUNT(*) as count FROM pragma_table_info('transcripts') WHERE name = ?`,
        [columnName],
        (err, row) => {
          if (err) {
            console.error(`Error checking for column ${columnName}:`, err);
            return;
          }
          
          if (row && row.count === 0) {
            db.run(`ALTER TABLE transcripts ADD COLUMN ${columnDef}`, (err) => {
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

    // Add each column if it doesn't exist
    addColumnIfNotExists('metadata', 'metadata JSON');
    addColumnIfNotExists('status', 'status TEXT DEFAULT "pending"');
    addColumnIfNotExists('confidence', 'confidence REAL');
    addColumnIfNotExists('speaker_count', 'speaker_count INTEGER');

    // Log final table schema
    interface TableInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    db.all<TableInfo>(
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