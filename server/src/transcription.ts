// server/src/transcription.ts
import { AssemblyAI } from 'assemblyai'
import { dbAsync } from './db'
import { generateReadUrl } from './s3'
import dotenv from 'dotenv'
import type { Transcript } from 'assemblyai/dist/types/openapi.generated'

dotenv.config()

if (!process.env.ASSEMBLYAI_API_KEY) {
  throw new Error('ASSEMBLYAI_API_KEY is required');
}

const assemblyai = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY
})

export async function startTranscription(
  recordingId: number, 
  s3Url: string,
  userId: string
): Promise<void> {
  try {
    // Update recording status to transcribing
    await dbAsync.run(
      `UPDATE recordings 
       SET status = 'transcribing' 
       WHERE id = ? AND user_id = ?`,
      [recordingId, userId]
    );

    // Generate a presigned URL for AssemblyAI to read the file
    const audioUrl = await generateReadUrl(s3Url);
    console.log('Generated presigned URL for AssemblyAI:', {
      objectKey: s3Url,
      urlLength: audioUrl.length
    });

    // First create a transcript record to track progress
    await dbAsync.run(
      `INSERT INTO transcripts (recording_id, content, status) 
       VALUES (?, ?, ?)`,
      [recordingId, '', 'processing']
    );

    // Start transcription
    const transcript = await assemblyai.transcripts.create({
      audio_url: audioUrl,
      speaker_labels: true,
      speakers_expected: 2
    });

    console.log('Started AssemblyAI transcription:', {
      transcriptId: transcript.id,
      status: transcript.status
    });

    // Poll for completion
    let result: Transcript;
    while (true) {
      const status = await assemblyai.transcripts.get(transcript.id);
      console.log('Transcription status update:', {
        transcriptId: transcript.id,
        status: status.status,
        hasText: !!status.text,
        utteranceCount: status.utterances?.length ?? 0
      });

      if (status.status === 'completed' && status.text) {
        result = status;
        break;
      } else if (status.status === 'error') {
        throw new Error(`Transcription failed: ${status.error}`);
      }
      // Wait for 3 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Update transcript record with results
    if (result && result.text) {
      // Clean metadata before storing
      const metadata = {
        utterances: result.utterances,
        confidence: result.confidence,
        words: result.words,
        speaker_labels: result.speaker_labels,
        // Add any other relevant fields but exclude large/unnecessary ones
      };

      await dbAsync.run(
        `UPDATE transcripts 
         SET content = ?,
             metadata = ?,
             status = ?,
             confidence = ?,
             speaker_count = ?
         WHERE recording_id = ?`,
        [
          result.text,
          JSON.stringify(metadata),
          'completed',
          result.confidence ?? 0,
          result.utterances?.length ?? 0,
          recordingId
        ]
      );

      // Update recording status
      await dbAsync.run(
        `UPDATE recordings 
         SET status = 'completed' 
         WHERE id = ?`,
        [recordingId]
      );

      console.log('Transcription completed successfully:', {
        recordingId,
        textLength: result.text.length,
        confidence: result.confidence,
        speakerCount: result.utterances?.length ?? 0
      });
    } else {
      throw new Error('Transcription completed but missing required data');
    }
  } catch (error) {
    console.error('Transcription error:', error);
    
    // Update both recordings and transcripts tables with error status
    await Promise.all([
      dbAsync.run(
        `UPDATE recordings 
         SET status = 'transcription_failed' 
         WHERE id = ?`,
        [recordingId]
      ),
      dbAsync.run(
        `UPDATE transcripts 
         SET status = 'error',
             metadata = ? 
         WHERE recording_id = ?`,
        [JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), recordingId]
      )
    ]);

    throw error;
  }
}