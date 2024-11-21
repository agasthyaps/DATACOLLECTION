// src/components/TranscriptModal.jsx
import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { X, Save, AlertCircle, Edit2, Loader } from 'lucide-react';

function TranscriptModal({ transcript, onClose, onUpdate }) {
  const [transcriptData, setTranscriptData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [saving, setSaving] = useState(false);
  const { getAccessTokenSilently } = useAuth0();
  const [isRetrying, setIsRetrying] = useState(false);

  const retryTranscription = async () => {
    try {
      setIsRetrying(true);
      setError(null);
      
      const token = await getAccessTokenSilently();
      const response = await fetch(`/api/admin/transcripts/${transcript.id}/retry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to retry transcription');
      }

      // Update the parent component
      onUpdate();
      
      // Close the modal since the transcript will need to be reprocessed
      onClose();
    } catch (error) {
      console.error('Error retrying transcription:', error);
      setError(error.message);
    } finally {
      setIsRetrying(false);
    }
  };


  useEffect(() => {
    fetchTranscript();
  }, [transcript.id]); // Changed from transcript_url to id

  const fetchTranscript = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = await getAccessTokenSilently();
      
      console.log('Fetching read URL for transcript:', transcript.id);
      const urlResponse = await fetch(`/api/admin/transcripts/${transcript.id}/read-url`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!urlResponse.ok) {
        throw new Error('Failed to get transcript read URL');
      }

      const { readUrl } = await urlResponse.json();
      console.log('Got read URL, fetching transcript data');

      const transcriptResponse = await fetch(readUrl);
      if (!transcriptResponse.ok) {
        throw new Error('Failed to fetch transcript data');
      }

      const data = await transcriptResponse.json();
      console.log('Received transcript data:', {
        hasText: !!data.text,
        utteranceCount: data.metadata?.utterances?.length
      });

      setTranscriptData(data);
      setEditedText(data.text);
    } catch (error) {
      console.error('Error fetching transcript:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveTranscript = async () => {
    try {
      setSaving(true);
      setError(null);
      
      const token = await getAccessTokenSilently();
      
      // Preserve the original metadata structure
      const updatedData = {
        ...transcriptData,
        text: editedText,
        editedAt: new Date().toISOString(),
        editedByAdmin: true
      };

      const response = await fetch(`/api/admin/transcripts/${transcript.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedData)
      });

      if (!response.ok) {
        throw new Error('Failed to save transcript');
      }

      setEditing(false);
      setTranscriptData(updatedData);
      onUpdate();
    } catch (error) {
      console.error('Error saving transcript:', error);
      setError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const renderTranscript = () => {
    if (!transcriptData?.metadata?.utterances) {
      return (
        <div className="text-gray-500 italic">
          No speaker data available. Showing raw transcript:
          <div className="mt-2 text-gray-900 not-italic">
            {transcriptData?.text}
          </div>
        </div>
      );
    }

    return transcriptData.metadata.utterances.map((utterance, index) => (
      <div key={index} className="mb-4">
        <div className="font-medium text-gray-700 mb-1">
          Speaker {utterance.speaker}
          <span className="text-sm text-gray-500 ml-2">
            ({formatTimestamp(utterance.start)} - {formatTimestamp(utterance.end)})
          </span>
        </div>
        <div className="pl-4 text-gray-900">
          {utterance.text}
        </div>
      </div>
    ));
  };

  const formatTimestamp = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">
            Transcript
            {transcriptData?.editedByAdmin && 
              <span className="ml-2 text-sm text-gray-500">(Edited)</span>
            }
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-4 max-h-[calc(90vh-8rem)] overflow-y-auto">
          {loading ? (
            <div className="text-center py-4 text-gray-500">
              <Loader className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading transcript...
            </div>
          ) : error ? (
            <div className="text-center py-4 text-red-600">
              <AlertCircle className="w-6 h-6 mx-auto mb-2" />
              <div className="text-red-600 mb-4">{error}</div>
              {transcript.transcript_status === 'error' && (
                <button
                  onClick={retryTranscription}
                  disabled={isRetrying}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  {isRetrying ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retry Transcription
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <>
              {editing ? (
                <div>
                  <div className="mb-2 text-sm text-gray-500">
                    Edit the transcript text below:
                  </div>
                  <textarea
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="w-full h-96 p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {renderTranscript()}
                  
                  {transcriptData?.metadata?.confidence && (
                    <div className="mt-4 text-sm text-gray-500">
                      Confidence Score: {(transcriptData.metadata.confidence * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 bg-gray-50 flex justify-end gap-2">
          {error && (
            <button
              onClick={fetchTranscript}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Retry
            </button>
          )}

          {!editing && !error && !loading && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              <Edit2 className="w-4 h-4 mr-2" />
              Edit
            </button>
          )}
          
          {editing && (
            <>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditedText(transcriptData.text);
                }}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveTranscript}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                {saving ? (
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TranscriptModal;