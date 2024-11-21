import React, { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Plus, UserPlus, RefreshCw, X } from 'lucide-react';
import { apiRequest } from '../utils/api';

const AdminManagement = ({ onClose }) => {
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [status, setStatus] = useState('');
  const { getAccessTokenSilently } = useAuth0();
  const [isLoading, setIsLoading] = useState(false);

  const addAdmin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setStatus('');

    try {
      const token = await getAccessTokenSilently();
      const response = await apiRequest('/api/admin/team', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ email: newAdminEmail })
      });

      if (response.ok) {
        setStatus('Admin added successfully');
        setNewAdminEmail('');
      } else {
        setStatus('Failed to add admin');
      }
    } catch (error) {
      setStatus('Error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const syncDatabase = async () => {
    setIsLoading(true);
    setStatus('');

    try {
      const token = await getAccessTokenSilently();
      const response = await apiRequest('/api/admin/sync-database', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(`Database synced: ${data.addedCount} records added`);
      } else {
        setStatus('Failed to sync database');
      }
    } catch (error) {
      setStatus('Error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Admin Management</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={addAdmin} className="mb-6">
          <div className="flex gap-2">
            <input
              type="email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="Enter admin email"
              className="flex-1 p-2 border rounded"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !newAdminEmail}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Add
            </button>
          </div>
        </form>

        {newAdminEmail === 'aps@actually-useful.xyz' && (
          <div className="mb-6">
            <button
              onClick={syncDatabase}
              disabled={isLoading}
              className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Sync Database with S3
            </button>
          </div>
        )}

        {status && (
          <div className={`mt-4 p-2 rounded ${
            status.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminManagement;