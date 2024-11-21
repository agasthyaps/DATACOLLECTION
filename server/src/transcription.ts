// server/src/transcription.ts
import { AssemblyAI } from 'assemblyai'
import { dbAsync } from './db'
import { generateReadUrl, generateTranscriptUploadUrl } from './s3'
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
    
    // When transcription is complete:
    if (result && result.text) {
      // Generate preview text (first 500 characters)
      const previewText = result.text.slice(0, 500) + (result.text.length > 500 ? '...' : '');

      // Get participant ID from the recording
      const recording = await dbAsync.get<{ participant_id: string }>(
        'SELECT participant_id FROM recordings WHERE id = ?',
        [recordingId]
      );

      if (!recording) {
        throw new Error('Recording not found');
      }

      // Generate upload URL for transcript
      const { uploadUrl, objectKey } = await generateTranscriptUploadUrl(
        userId,
        recording.participant_id,
        recordingId.toString()
      );

      // Prepare transcript data for S3
      const transcriptData = {
        text: result.text,
        metadata: {
          utterances: result.utterances,
          confidence: result.confidence,
          words: result.words,
          speaker_labels: result.speaker_labels,
        },
        recordingId,
        timestamp: new Date().toISOString()
      };

      // Upload to S3
      await fetch(uploadUrl, {
        method: 'PUT',
        body: JSON.stringify(transcriptData),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Update database with new transcript info
      await dbAsync.run(
        `UPDATE transcripts 
         SET s3_url = ?,
             preview_text = ?,
             status = ?,
             confidence = ?,
             speaker_count = ?,
             content = ?,
             created_at = CURRENT_TIMESTAMP
         WHERE recording_id = ?`,
        [
          objectKey,
          previewText,
          'completed',
          result.confidence ?? 0,
          result.utterances?.length ?? 0,
          result.text,  // Store in content field as well for backwards compatibility
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

      console.log('Transcription completed and saved:', {
        recordingId,
        s3Url: objectKey,
        previewLength: previewText.length,
        confidence: result.confidence,
        speakerCount: result.utterances?.length ?? 0
      });
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
             error_message = ?,
             retry_count = retry_count + 1
         WHERE recording_id = ?`,
        [error instanceof Error ? error.message : 'Unknown error', recordingId]
      )
    ]);

    throw error;
  }
}