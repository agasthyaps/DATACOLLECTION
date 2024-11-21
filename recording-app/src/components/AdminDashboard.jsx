// src/components/AdminDashboard.jsx
import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { ArrowLeft, Play, FileText, AlertCircle, CheckCircle, Clock, RefreshCcw } from 'lucide-react';
import AudioPlayer from './AudioPlayer';
import TranscriptModal from './TranscriptModal'


function AdminDashboard({ onExit }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { getAccessTokenSilently } = useAuth0();
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [selectedTranscript, setSelectedTranscript] = useState(null);

  const handleTranscriptUpdate = async () => {
    // Refresh the recordings list to get updated transcript status
    await fetchRecordings();
  };



  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      const response = await fetch('/api/admin/recordings', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Received recordings data:', data);
      
      // Handle the wrapped recordings array
      setRecordings(data.recordings || []);
    } catch (error) {
      console.error('Error fetching recordings:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <button
            onClick={onExit}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Recording
          </button>
        </div>
        
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-5 sm:p-6">
            <div className="sm:flex sm:items-center">
              <div className="sm:flex-auto">
                <h1 className="text-2xl font-semibold text-gray-900">
                  Research Recordings
                </h1>
                <p className="mt-2 text-sm text-gray-700">
                  A list of all recordings and their transcriptions.
                </p>
              </div>
              <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
                <button
                  onClick={fetchRecordings}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  Refresh
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12">
                <div className="text-gray-500">Loading recordings...</div>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <div className="text-red-500 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  {error}
                </div>
                <button
                  onClick={fetchRecordings}
                  className="mt-4 text-blue-600 hover:text-blue-800"
                >
                  Try Again
                </button>
              </div>
            ) : recordings.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500">No recordings found</div>
              </div>
            ) : (
              <div className="mt-8 flow-root">
                <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                  <div className="inline-block min-w-full py-2 align-middle">
                    <table className="min-w-full divide-y divide-gray-300">
                      <thead>
                        <tr>
                          <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                            Date
                          </th>
                          <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                            Researcher
                          </th>
                          <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                            Participant
                          </th>
                          <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                            Status
                          </th>
                          <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {recordings.map((recording) => (
                          <tr key={recording.id}>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                              {formatDate(recording.recorded_at)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                              {recording.researcher_email}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                              {recording.participant_identifier}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm">
                              <span 
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  recording.transcript_status === 'completed'
                                    ? 'bg-green-100 text-green-800'
                                    : recording.transcript_status === 'error'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                {recording.transcript_status === 'completed' && <CheckCircle className="w-4 h-4 mr-1" />}
                                {recording.transcript_status === 'error' && <AlertCircle className="w-4 h-4 mr-1" />}
                                {recording.transcript_status === 'pending' && <Clock className="w-4 h-4 mr-1" />}
                                {recording.transcript_status || 'Pending'}
                              </span>
                            </td>
                            <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                              <div className="flex justify-end gap-3">
                                <button 
                                    onClick={() => setSelectedRecording(recording.id)}
                                    className="text-blue-600 hover:text-blue-900"
                                    >
                                    <Play className="w-4 h-4" />
                                </button>
                                {recording.transcript_status === 'completed' && (
                                    <button 
                                    onClick={() => setSelectedTranscript(recording)}
                                    className="text-blue-600 hover:text-blue-900"
                                    >
                                    <FileText className="w-4 h-4" />
                                    </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {selectedTranscript && (
          <TranscriptModal
            transcript={selectedTranscript}
            onClose={() => setSelectedTranscript(null)}
            onUpdate={handleTranscriptUpdate}
          />
        )}
        {selectedRecording && (
            <AudioPlayer
            recordingId={selectedRecording}
            onClose={() => setSelectedRecording(null)}
            />
        )}
      </div>
    </div>
  );
}


export default AdminDashboard;