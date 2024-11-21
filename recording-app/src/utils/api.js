const getApiUrl = () => {
    return import.meta.env.VITE_API_URL || '';
  };
  
  export const apiRequest = async (endpoint, options = {}) => {
    const baseUrl = getApiUrl();
    const url = `${baseUrl}${endpoint}`;
    console.log('Making API request to:', url);
    
    const response = await fetch(url, options);
    if (!response.ok && !options.skipErrorLog) {
      console.error('API request failed:', {
        endpoint,
        status: response.status,
        statusText: response.statusText
      });
    }
    return response;
  };