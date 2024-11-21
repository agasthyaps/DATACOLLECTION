import { useState, useRef, useEffect } from 'react'
import { 
  Mic, 
  StopCircle, 
  User, 
  LogOut, 
  Play, 
  Square, 
  Upload, 
  Settings,  // Added this import
  Cog  // Alternative icon if you prefer
} from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import AdminDashboard from './components/AdminDashboard'
import AudioPlayer from './components/AudioPlayer'
import './index.css'
import { apiRequest } from './utils/api';


function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [isAdminView, setIsAdminView] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [selectedParticipant, setSelectedParticipant] = useState('')
  const [uploadStatus, setUploadStatus] = useState(null) // 'uploading' | 'success' | 'error' | null
  const [audioUrl, setAudioUrl] = useState(null) // URL for audio preview
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef(null)
  const { isAuthenticated, loginWithRedirect, logout, user, isLoading, getAccessTokenSilently } = useAuth0()

  // Check if user is admin when they log in
  useEffect(() => {
    console.log('Auth effect running, user:', user);
    if (user?.email) {
      console.log('Checking admin status for:', user.email);
      checkAdminStatus();
    }
  }, [user]);

  const checkAdminStatus = async () => {
    try {
      const token = await getAccessTokenSilently();
      console.log('Got token, checking admin status...');
      
      const response = await apiRequest('/api/admin/team', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      console.log('Admin check response:', response.status);
      
      if (response.ok) {
        console.log('User is admin!');
        setIsAdmin(true);
      } else {
        console.log('User is not admin');
        setIsAdmin(false);
      }
    } catch (error) {
      console.error('Admin check error:', error);
      setIsAdmin(false);
    }
  };

  const audioChunks = useRef([])
  const currentBlob = useRef(null)

  const uploadToS3 = async (audioBlob) => {
    try {
      setUploadStatus('uploading')
      console.log('Starting upload process...')
      
      // Get auth token
      const token = await getAccessTokenSilently()
      console.log('Got auth token:', token.substring(0, 20) + '...')
      
      // 1. Get presigned URL
      const requestUrl = '/api/recordings/upload-url'
      const requestBody = { participantId: selectedParticipant }
      
      console.log('Making request to:', requestUrl)
      console.log('Request payload:', requestBody)
      console.log('Request headers:', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.substring(0, 20)}...`
      })
  
      const response = await apiRequest(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });
  
      console.log('Response status:', response.status)
      console.log('Response headers:', Object.fromEntries(response.headers))
      
      if (!response.ok) {
        const errorText = await response.text()
        console.log('Error response body:', errorText || '(empty response)')
        throw new Error(`Failed to get upload URL: ${errorText || response.statusText}`)
      }
  
      const data = await response.json()
      console.log('Got presigned URL response:', data)
      
      const { uploadUrl, recordingId } = data;
  
      // 2. Upload to S3
      console.log('Starting S3 upload...')
      console.log('Upload URL:', uploadUrl)
      console.log('File size:', audioBlob.size, 'bytes')
      console.log('Content type:', audioBlob.type)
  
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: audioBlob,
        headers: {
          'Content-Type': 'audio/webm',
          // Don't include Authorization header for S3 upload
        }
      });
  
      if (!uploadResponse.ok) {
        const uploadErrorText = await uploadResponse.text()
        console.log('S3 upload error:', uploadErrorText || '(empty response)')
        throw new Error('Failed to upload recording to S3')
      }
  
      console.log('S3 upload successful')
  
      // 3. Mark recording as complete
      console.log('Marking recording as complete...')
      const completeUrl = `/api/recordings/${recordingId}/complete`
      
      const completeResponse = await apiRequest(completeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
  
      if (!completeResponse.ok) {
        const completeErrorText = await completeResponse.text()
        console.log('Complete error:', completeErrorText || '(empty response)')
        throw new Error('Failed to mark recording as complete')
      }
  
      console.log('Recording marked as complete')
      setUploadStatus('success')
      
      // Clean up
      setAudioUrl(null)
      currentBlob.current = null
      
      return true
      
    } catch (error) {
      console.error('Upload error:', error)
      console.error('Error stack:', error.stack)
      setUploadStatus('error')
      return false
    }
  };

  const startRecording = async () => {
    try {
      // Clear any existing audio
      setAudioUrl(null);
      currentBlob.current = null;
      audioChunks.current = [];
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' })
        currentBlob.current = audioBlob;
        const url = URL.createObjectURL(audioBlob)
        setAudioUrl(url)
        console.log('Recording stopped, blob created:', audioBlob)
      }

      recorder.start()
      setMediaRecorder(recorder)
      setIsRecording(true)
      setUploadStatus(null)
    } catch (err) {
      console.error('Error accessing microphone:', err)
      alert('Error accessing microphone. Please ensure microphone permissions are granted.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
      mediaRecorder.stream.getTracks().forEach(track => track.stop())
      setIsRecording(false)
      setMediaRecorder(null)
    }
  }

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleAudioEnded = () => {
    setIsPlaying(false)
  }

  const handleSubmit = async () => {
    if (currentBlob.current) {
      await uploadToS3(currentBlob.current)
    }
  }

  if (isAuthenticated && isAdmin && isAdminView) {
    return <AdminDashboard onExit={() => setIsAdminView(false)} />;
  }
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100">
        <main className="container mx-auto max-w-2xl px-4 py-8">
          <div className="rounded-lg bg-white p-6 shadow-lg text-center">
            <User className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h1 className="text-2xl font-bold mb-6">TL Data Collection Prototype 🧪</h1>
            <button
              onClick={() => loginWithRedirect()}
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
            >
              Log In
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="container mx-auto max-w-2xl px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <User className="h-6 w-6 text-gray-400" />
            <span className="font-medium">{user?.name}</span>
            {isAuthenticated && (
              <div className="text-xs text-gray-500 mt-2">
                Logged in as: {user?.email} 
                Admin status: {isAdmin ? 'Yes' : 'No'}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {isAdmin && (
              <button
                onClick={() => setIsAdminView(!isAdminView)}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
              >
                <Settings className="h-5 w-5" />
                {isAdminView ? 'Exit Admin' : 'Admin Panel'}
              </button>
            )}
            <button
              onClick={() => logout({ returnTo: window.location.origin })}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <LogOut className="h-5 w-5" />
              Log Out
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg bg-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-center mb-6">Record Coaching Conversation</h1>
          
          <input
            type="text"
            value={selectedParticipant}
            onChange={(e) => setSelectedParticipant(e.target.value)}
            placeholder="Enter teacher identifier (who are you talking to right now?)"
            className="w-full p-2 mb-6 border rounded-md"
            disabled={isRecording || uploadStatus === 'uploading'}
          />

          {!audioUrl && (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!selectedParticipant || uploadStatus === 'uploading'}
              className={`w-full h-32 rounded-full flex items-center justify-center ${
                isRecording 
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-blue-600 hover:bg-blue-700'
              } ${(!selectedParticipant || uploadStatus === 'uploading') && 'opacity-50 cursor-not-allowed'}`}
            >
              {isRecording ? (
                <StopCircle className="h-16 w-16 text-white" />
              ) : (
                <Mic className="h-16 w-16 text-white" />
              )}
            </button>
          )}
          
          {audioUrl && (
            <div className="space-y-4">
              <audio ref={audioRef} src={audioUrl} onEnded={handleAudioEnded} className="hidden" />
              
              <div className="flex justify-center gap-4">
                <button
                  onClick={handlePlayPause}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-full flex items-center gap-2"
                >
                  {isPlaying ? <Square className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  {isPlaying ? 'Stop' : 'Play'}
                </button>

                <button
                  onClick={handleSubmit}
                  disabled={uploadStatus === 'uploading'}
                  className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-full flex items-center gap-2"
                >
                  <Upload className="h-5 w-5" />
                  Submit
                </button>
              </div>

              <button
                onClick={() => {
                  setAudioUrl(null);
                  currentBlob.current = null;
                }}
                className="w-full text-red-600 hover:text-red-700 text-sm"
              >
                Discard and record again
              </button>
            </div>
          )}
          
          <div className="mt-4 text-center">
            {isRecording && (
              <div className="text-red-600">
                Recording in progress...
              </div>
            )}
            {uploadStatus === 'uploading' && (
              <div className="text-blue-600">
                Uploading recording...
              </div>
            )}
            {uploadStatus === 'success' && (
              <div className="text-green-600">
                Recording uploaded successfully!
              </div>
            )}
            {uploadStatus === 'error' && (
              <div className="text-red-600">
                Error uploading recording. Please try again.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default App